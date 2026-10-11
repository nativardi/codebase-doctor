const fs = require('fs');
const path = require('path');

const { hashBuffer } = require('./cache');

const DEFAULT_SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.yarn',
  '.pnpm-store',
  '.cache',
  'dist',
  'build',
  'coverage',
  'out',
  'target',
  '.optimization',
]);

const CONFIG_FILENAMES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'jsconfig.json',
  'vite.config.js',
  'vite.config.ts',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Dockerfile',
  '.env.example',
  'requirements.txt',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'Makefile',
]);

const DOC_FILENAMES = new Set(['README.md', 'CHANGELOG.md', 'METHODOLOGY.md', 'QUICKSTART.md']);

const TEST_PATH_PATTERNS = [/__tests__/i, /\.test\./i, /\.spec\./i, /^tests\//i, /\/tests\//i];

function createIgnoreMatcher(projectPath) {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const rules = [];

  if (fs.existsSync(gitignorePath)) {
    const lines = fs
      .readFileSync(gitignorePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    rules.push(...lines);
  }

  rules.push('.git', 'node_modules', '.optimization');

  return {
    ignores(relativePath) {
      return rules.some((rule) => matchIgnoreRule(rule, relativePath));
    },
  };
}

function matchIgnoreRule(rule, relativePath) {
  const normalizedPath = relativePath.split(path.sep).join('/');
  const normalizedRule = rule.replace(/\/+$/, '');

  if (!normalizedRule) {
    return false;
  }

  if (rule.endsWith('/')) {
    return normalizedPath === normalizedRule || normalizedPath.startsWith(`${normalizedRule}/`);
  }

  if (!normalizedRule.includes('*') && !normalizedRule.includes('/')) {
    return path.basename(normalizedPath) === normalizedRule;
  }

  const escaped = normalizedRule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(normalizedPath);
}

function matchGlob(glob, relativePath) {
  const normalizedPath = relativePath.split(path.sep).join('/');
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`).test(normalizedPath);
}

function isBinaryBuffer(buffer) {
  if (!buffer.length) {
    return false;
  }

  let suspicious = 0;
  const sampleSize = Math.min(buffer.length, 4096);

  for (let index = 0; index < sampleSize; index += 1) {
    const byte = buffer[index];

    if (byte === 0) {
      return true;
    }

    const isControl = byte < 7 || (byte > 14 && byte < 32);
    if (isControl) {
      suspicious += 1;
    }
  }

  return suspicious / sampleSize > 0.3;
}

function classifyFile(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const basename = path.basename(normalized);

  if (CONFIG_FILENAMES.has(basename) || basename.startsWith('.env')) {
    return 'config';
  }

  if (DOC_FILENAMES.has(basename) || normalized.startsWith('docs/')) {
    return 'docs';
  }

  if (TEST_PATH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'tests';
  }

  return 'source';
}

function updateLanguageCounts(languageCounts, relativePath) {
  const extension = path.extname(relativePath).slice(1).toLowerCase() || 'no_extension';
  languageCounts[extension] = (languageCounts[extension] || 0) + 1;
}

function scanProject(projectPath, options = {}) {
  const fileSizeLimitBytes = options.fileSizeLimitBytes || 102400;
  const matcher = createIgnoreMatcher(projectPath);
  const includeGlobs = options.includeGlobs || [];
  const excludeGlobs = options.excludeGlobs || [];
  const includedFiles = [];
  const skippedFiles = [];
  const languageCounts = {};
  const testLocations = [];
  const configLocations = [];
  const docsLocations = [];

  const stack = ['.'];

  while (stack.length) {
    const currentRelative = stack.pop();
    const currentAbsolute = path.join(projectPath, currentRelative);
    const stat = fs.statSync(currentAbsolute);

    if (stat.isDirectory()) {
      const directoryName = path.basename(currentRelative);
      if (currentRelative !== '.' && DEFAULT_SKIPPED_DIRS.has(directoryName)) {
        skippedFiles.push({
          path: currentRelative,
          reason: 'ignored_directory',
        });
        continue;
      }

      const entries = fs.readdirSync(currentAbsolute).sort().reverse();
      for (const entry of entries) {
        const childRelative = currentRelative === '.' ? entry : path.join(currentRelative, entry);
        const gitStylePath = childRelative.split(path.sep).join('/');

        if (matcher.ignores(gitStylePath)) {
          skippedFiles.push({
            path: gitStylePath,
            reason: 'gitignored',
          });
          continue;
        }

        stack.push(childRelative);
      }
      continue;
    }

    const relativePath = currentRelative.split(path.sep).join('/');

    if (excludeGlobs.some((glob) => matchGlob(glob, relativePath))) {
      skippedFiles.push({
        path: relativePath,
        reason: 'excluded_glob',
      });
      continue;
    }

    if (includeGlobs.length && !includeGlobs.some((glob) => matchGlob(glob, relativePath))) {
      skippedFiles.push({
        path: relativePath,
        reason: 'not_included',
      });
      continue;
    }

    if (stat.size > fileSizeLimitBytes) {
      skippedFiles.push({
        path: relativePath,
        reason: 'size_limit',
        size: stat.size,
      });
      continue;
    }

    const buffer = fs.readFileSync(currentAbsolute);
    if (isBinaryBuffer(buffer)) {
      skippedFiles.push({
        path: relativePath,
        reason: 'binary',
        size: buffer.length,
      });
      continue;
    }

    const content = buffer.toString('utf8');
    const category = classifyFile(relativePath);

    includedFiles.push({
      path: relativePath,
      absolutePath: currentAbsolute,
      size: stat.size,
      extension: path.extname(relativePath).slice(1).toLowerCase() || null,
      category,
      hash: hashBuffer(buffer),
      content,
    });

    updateLanguageCounts(languageCounts, relativePath);

    if (category === 'tests') {
      testLocations.push(relativePath);
    } else if (category === 'config') {
      configLocations.push(relativePath);
    } else if (category === 'docs') {
      docsLocations.push(relativePath);
    }
  }

  includedFiles.sort((left, right) => left.path.localeCompare(right.path));
  skippedFiles.sort((left, right) => left.path.localeCompare(right.path));

  return {
    projectPath,
    manifest: {
      includedFiles,
      skippedFiles,
      fileCounts: {
        total: includedFiles.length,
        byExtension: languageCounts,
      },
      languageCounts,
      locations: {
        tests: testLocations,
        config: configLocations,
        docs: docsLocations,
      },
    },
  };
}

module.exports = {
  DEFAULT_SKIPPED_DIRS,
  classifyFile,
  isBinaryBuffer,
  matchGlob,
  scanProject,
};
