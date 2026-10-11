const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function ensureOutputDir(projectPath, outputDir) {
  return ensureDir(path.join(projectPath, outputDir));
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function hashObject(value) {
  return hashContent(stableStringify(value));
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getCachePaths(outputPath) {
  const cacheDir = path.join(outputPath, '.cache');
  return {
    cacheDir,
    latestRunPath: path.join(cacheDir, 'latest-run.json'),
  };
}

function buildAnalysisCacheKey(scanResult, config, options = {}) {
  return hashObject({
    files: scanResult.manifest.includedFiles.map((file) => ({ path: file.path, hash: file.hash })),
    skipped: scanResult.manifest.skippedFiles.map((file) => ({ path: file.path, reason: file.reason })),
    fileSizeLimitBytes: config.fileSizeLimitBytes,
    outputDir: config.outputDir,
    concurrency: options.concurrency || config.concurrency,
    models: config.models,
  });
}

module.exports = {
  buildAnalysisCacheKey,
  ensureDir,
  ensureOutputDir,
  getCachePaths,
  hashBuffer,
  hashContent,
  hashObject,
  readJson,
  stableStringify,
  writeJson,
};
