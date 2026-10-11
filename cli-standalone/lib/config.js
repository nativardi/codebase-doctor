const path = require('path');
const fs = require('fs');

const DOMAIN_ORDER = [
  'security',
  'external',
  'data',
  'backend',
  'frontend',
  'infrastructure',
  'performance',
  'quality',
];

const DEFAULT_CONFIG = {
  outputDir: '.optimization',
  fileSizeLimitBytes: 102400,
  concurrency: 3,
  frameworkPath: process.env.DOCTOR_PATH || path.join(__dirname, '..', '..'),
  includeGlobs: [],
  excludeGlobs: [],
  outputFormats: ['json', 'md', 'execution-plan'],
  severityThresholds: {
    critical: 1,
  },
  ci: {
    failOn: {
      critical: 1,
    },
  },
  models: {
    haiku: 'claude-haiku-4-5',
    sonnet: 'claude-sonnet-5-5',
    opus: 'claude-opus-5-5',
  },
  // USD per million tokens, keyed by model id. Unknown ids fall back to the sonnet rate.
  pricing: {
    'claude-haiku-4-5': { input: 1, output: 5 },
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-opus-5-5': { input: 4, output: 20 },
  },
  modelFallbacks: {
    opus: ['sonnet', 'haiku'],
    sonnet: ['haiku'],
    haiku: [],
  },
  domains: {
    discovery: { model: 'haiku', priority: 0 },
    security: { model: 'opus', priority: 1 },
    external: { model: 'opus', priority: 1 },
    data: { model: 'sonnet', priority: 1 },
    backend: { model: 'sonnet', priority: 1 },
    frontend: { model: 'sonnet', priority: 2 },
    infrastructure: { model: 'sonnet', priority: 2 },
    performance: { model: 'sonnet', priority: 2 },
    quality: { model: 'sonnet', priority: 2 },
    synthesis: { model: 'opus', priority: 3 },
  },
  promptLimits: {
    discoveryMaxFiles: 24,
    domainMaxFiles: 40,
    synthesisMaxFindings: 200,
    maxChars: 180000,
  },
};

function mergeConfig(base, overrides) {
  return {
    ...base,
    ...overrides,
    ci: {
      ...(base.ci || {}),
      ...(overrides.ci || {}),
      failOn: {
        ...(base.ci?.failOn || {}),
        ...(overrides.ci?.failOn || {}),
      },
    },
    models: {
      ...base.models,
      ...(overrides.models || {}),
    },
    pricing: {
      ...(base.pricing || {}),
      ...(overrides.pricing || {}),
    },
    domains: {
      ...base.domains,
      ...(overrides.domains || {}),
    },
    promptLimits: {
      ...base.promptLimits,
      ...(overrides.promptLimits || {}),
    },
  };
}

function createConfig(overrides = {}) {
  return mergeConfig(DEFAULT_CONFIG, overrides);
}

function loadConfigFile(projectPath, explicitConfigPath) {
  const configPath = explicitConfigPath
    ? path.resolve(explicitConfigPath)
    : path.join(projectPath, '.codebase-doctor.config.json');

  if (!fs.existsSync(configPath)) {
    return { configPath, fileConfig: {} };
  }

  try {
    return {
      configPath,
      fileConfig: JSON.parse(fs.readFileSync(configPath, 'utf8')),
    };
  } catch (error) {
    throw new Error(`Invalid Codebase Doctor config at ${configPath}: ${error.message}`);
  }
}

function resolveCliConfigOverrides(options = {}) {
  const overrides = {};

  if (options.concurrency) {
    overrides.concurrency = options.concurrency;
  }

  if (options.outputDir) {
    overrides.outputDir = options.outputDir;
  }

  if (options.fileSizeLimitBytes) {
    overrides.fileSizeLimitBytes = options.fileSizeLimitBytes;
  }

  return overrides;
}

function loadResolvedConfig(projectPath, options = {}) {
  const { configPath, fileConfig } = loadConfigFile(projectPath, options.configPath);
  const cliConfig = resolveCliConfigOverrides(options);
  return {
    configPath,
    config: createConfig(mergeConfig(fileConfig, cliConfig)),
  };
}

function resolveProjectPaths(projectPath, config) {
  const outputPath = path.join(projectPath, config.outputDir);
  return {
    outputPath,
    discoveryPath: path.join(outputPath, 'discovery.json'),
    reportPath: path.join(outputPath, 'report.md'),
    canonicalReportPath: path.join(outputPath, 'report.json'),
    executionPlanPath: path.join(outputPath, 'execution-plan.md'),
    synthesisPath: path.join(outputPath, 'synthesis.json'),
    allFindingsPath: path.join(outputPath, 'all-findings.json'),
  };
}

module.exports = {
  DEFAULT_CONFIG,
  DOMAIN_ORDER,
  createConfig,
  loadResolvedConfig,
  resolveProjectPaths,
};
