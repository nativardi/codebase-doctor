const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const { buildAnalysisCacheKey, ensureOutputDir, getCachePaths, readJson, writeJson } = require('./cache');
const { loadResolvedConfig, resolveProjectPaths } = require('./config');
const {
  DOMAIN_REGISTRY,
  generateDiscoveryPrompt,
  generateDomainPrompt,
  generateSynthesisPrompt,
  getRelevantDomains,
} = require('./domains');
const { buildCanonicalReport, countBySeverity, generatePRDescriptions, writeCanonicalArtifacts } = require('./reporter');
const { scanProject } = require('./scanner');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function createLogger(options = {}) {
  const silent = Boolean(options.silent || options.ci);

  function write(message, color = 'reset') {
    if (silent) {
      return;
    }

    console.log(`${colors[color]}${message}${colors.reset}`);
  }

  return {
    log: write,
    step(step, message) {
      write(`\n[${step}] ${message}`, 'cyan');
    },
    success(message) {
      write(`✓ ${message}`, 'green');
    },
    error(message) {
      write(`✗ ${message}`, 'red');
    },
  };
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) {
    throw new Error('No JSON content found in model response');
  }

  return JSON.parse(match[0]);
}

function createAnthropicExecutor(config) {
  const client = new Anthropic();

  return async function executeTask(task) {
    const stream = client.messages.stream({
      model: config.models[task.model],
      max_tokens: 16000,
      messages: [{ role: 'user', content: task.prompt }],
    });

    if (typeof task.onText === 'function') {
      stream.on('text', task.onText);
    }

    const response = await stream.finalMessage();
    const textBlock = response.content.find((item) => item.type === 'text');
    const rawText = textBlock ? textBlock.text : '';

    return {
      data: extractJson(rawText),
      rawText,
      usage: response.usage || {},
    };
  };
}

function isRetryableModelError(error) {
  const message = `${error?.message || ''}`.toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('overloaded') ||
    message.includes('unavailable') ||
    message.includes('529') ||
    message.includes('timeout')
  );
}

function getModelChain(model, config) {
  return [model, ...(config.modelFallbacks[model] || [])];
}

async function executeWithFallback(executor, task, config) {
  const warnings = [];
  const attemptedModels = getModelChain(task.model, config);
  let lastError;

  for (let index = 0; index < attemptedModels.length; index += 1) {
    const currentModel = attemptedModels[index];
    try {
      const result = await executor({ ...task, model: currentModel });
      return {
        ...result,
        model: currentModel,
        fallbackUsed: index > 0,
        warnings,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableModelError(error) || index === attemptedModels.length - 1) {
        break;
      }

      warnings.push(`Fell back from ${task.model} to ${attemptedModels[index + 1]} for ${task.label}.`);
    }
  }

  throw lastError;
}

function createProgressTracker(domains, logger, options = {}) {
  const state = Object.fromEntries(
    domains.map((domain) => [
      domain,
      {
        status: 'queued',
        elapsedMs: 0,
        usage: {},
      },
    ]),
  );

  function update(domain, patch) {
    state[domain] = { ...state[domain], ...patch };

    if (!options.silent && !options.ci) {
      logger.log(
        `  [${domain}] ${state[domain].status} (${Math.round(state[domain].elapsedMs || 0)}ms)`,
        state[domain].status === 'failed' ? 'red' : state[domain].status === 'completed' ? 'green' : 'yellow',
      );
    }

    if (typeof options.onProgress === 'function') {
      options.onProgress(domain, state[domain], state);
    }
  }

  return { state, update };
}

function createConcurrencyLimiter(limit) {
  let active = 0;
  const waiters = [];

  return async function runLimited(taskFactory) {
    if (active >= limit) {
      await new Promise((resolve) => waiters.push(resolve));
    }

    active += 1;
    try {
      return await taskFactory();
    } finally {
      active -= 1;
      const next = waiters.shift();
      if (next) {
        next();
      }
    }
  };
}

async function runWithConcurrency(taskFactories, limit) {
  const runLimited = createConcurrencyLimiter(limit);
  return Promise.allSettled(taskFactories.map((taskFactory) => runLimited(taskFactory)));
}

function buildCoverage(domainResults, totalDomains) {
  return {
    completed: domainResults.filter((result) => result.status === 'completed').length,
    total: totalDomains,
  };
}

function hydrateCachedRun(cachedRun, outputPath) {
  writeCanonicalArtifacts(outputPath, cachedRun.report);
}

function normalizeSynthesisFallback(allFindings, coverage) {
  return {
    summary: {
      total_findings: allFindings.length,
      by_severity: countBySeverity(allFindings),
      health_score: 0,
      coverage,
    },
    systemic_patterns: [],
  };
}

async function runAnalysis(projectPath, options = {}, dependencies = {}) {
  const { configPath, config } = loadResolvedConfig(projectPath, options);
  const logger = dependencies.logger || createLogger(options);
  const executor = dependencies.executor || createAnthropicExecutor(config);
  const startedAt = Date.now();
  const outputPath = ensureOutputDir(projectPath, config.outputDir);
  const paths = resolveProjectPaths(projectPath, config);
  const previousReport = readJson(paths.canonicalReportPath, null);
  const scanResult = scanProject(projectPath, {
    fileSizeLimitBytes: config.fileSizeLimitBytes,
    includeGlobs: config.includeGlobs,
    excludeGlobs: config.excludeGlobs,
  });
  const cachePaths = getCachePaths(outputPath);
  const concurrency = options.concurrency || config.concurrency;
  const cacheKey = buildAnalysisCacheKey(scanResult, config, { concurrency });
  const cachedRun = !options.force ? readJson(cachePaths.latestRunPath) : null;

  logger.log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  logger.log('║     Codebase Doctor       ║', 'cyan');
  logger.log('╚════════════════════════════════════════════════════════════╝', 'cyan');
  logger.log(`\nProject: ${projectPath}`, 'bright');
  logger.log(`Output:  ${outputPath}`, 'bright');

  if (cachedRun?.cacheKey === cacheKey) {
    logger.log('\nUsing cached analysis results for unchanged project state.', 'yellow');
    hydrateCachedRun(cachedRun, outputPath);
    return {
      config,
      outputPath,
      report: cachedRun.report,
      cached: true,
    };
  }

  logger.step('1/4', 'Discovery Phase (using Haiku)');

  let discoveryData;
  let discoveryUsage = {};
  if (options.skipDiscovery && fs.existsSync(paths.discoveryPath)) {
    logger.log('  Using cached discovery data', 'yellow');
    discoveryData = readJson(paths.discoveryPath);
  } else {
    const discoveryPrompt = generateDiscoveryPrompt(projectPath, scanResult, config);
    try {
      const result = await executeWithFallback(
        executor,
        {
          kind: 'discovery',
          label: 'discovery',
          model: config.domains.discovery.model,
          prompt: discoveryPrompt,
          projectPath,
          scanResult,
        },
        config,
      );
      discoveryData = result.data;
      discoveryUsage = result.usage || {};
      writeJson(paths.discoveryPath, discoveryData);
      logger.success('Discovery complete');
    } catch (error) {
      logger.error(`Discovery failed: ${error.message}`);
      throw error;
    }
  }

  logger.log(
    `\n  Tech Stack: ${Object.values(discoveryData.tech_stack || {}).flat().filter(Boolean).join(', ')}`,
    'cyan',
  );
  logger.log(`  Files: ${discoveryData.file_counts?.total || scanResult.manifest.fileCounts.total}`, 'cyan');

  logger.step('2/4', 'Domain Analysis');

  const relevantDomains = getRelevantDomains(discoveryData);
  const progress = createProgressTracker(relevantDomains, logger, options);

  const domainTaskFactories = relevantDomains.map((domain) => async () => {
    const registryEntry = DOMAIN_REGISTRY[domain];
    const startedDomainAt = Date.now();
    const domainTask = generateDomainPrompt(domain, projectPath, discoveryData, scanResult, config);

    progress.update(domain, { status: 'running', elapsedMs: 0 });

    try {
      const result = await executeWithFallback(
        executor,
        {
          kind: 'domain',
          label: domain,
          domain,
          model: registryEntry.model,
          prompt: domainTask.prompt,
          projectPath,
          discoveryData,
          scanResult,
          relevantPaths: domainTask.relevantPaths,
        },
        config,
      );

      progress.update(domain, {
        status: 'completed',
        elapsedMs: Date.now() - startedDomainAt,
        usage: result.usage || {},
      });

      logger.success(`${domain}: ${Array.isArray(result.data) ? result.data.length : 0} findings`);
      return {
        domain,
        status: 'completed',
        findings: Array.isArray(result.data) ? result.data : [],
        usage: result.usage || {},
        warnings: result.warnings || [],
        fallbackUsed: result.fallbackUsed,
        model: result.model,
      };
    } catch (error) {
      progress.update(domain, {
        status: 'failed',
        elapsedMs: Date.now() - startedDomainAt,
      });

      logger.error(`${domain} failed: ${error.message}`);
      return {
        domain,
        status: 'failed',
        findings: [],
        error: error.message,
        usage: {},
        warnings: [],
      };
    }
  });

  const settledDomainResults = await runWithConcurrency(domainTaskFactories, concurrency);
  const domainResults = settledDomainResults.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          domain: relevantDomains[index],
          status: 'failed',
          findings: [],
          error: result.reason?.message || 'Unknown domain failure',
          usage: {},
          warnings: [],
        },
  );
  const allFindings = domainResults.flatMap((result) => result.findings || []);
  const failedDomains = domainResults.filter((result) => result.status === 'failed');
  const fallbackWarnings = domainResults.flatMap((result) => result.warnings || []);
  const coverage = buildCoverage(domainResults, relevantDomains.length);

  logger.step('3/4', 'Synthesis Phase');

  const synthesisPrompt = generateSynthesisPrompt(projectPath, allFindings, discoveryData, scanResult, config);
  let synthesisResult;
  let synthesisUsage = {};

  try {
    const result = await executeWithFallback(
      executor,
      {
        kind: 'synthesis',
        label: 'synthesis',
        model: config.domains.synthesis.model,
        prompt: synthesisPrompt,
        projectPath,
        discoveryData,
        scanResult,
        findings: allFindings,
      },
      config,
    );
    synthesisResult = result.data;
    synthesisUsage = result.usage || {};
    logger.success('Synthesis complete');
  } catch (error) {
    logger.error(`Synthesis failed: ${error.message}`);
    synthesisResult = normalizeSynthesisFallback(allFindings, coverage);
  }

  logger.step('4/4', 'Generating Reports');

  const report = buildCanonicalReport({
    projectPath,
    config,
    configPath,
    discoveryData,
    discoveryUsage,
    scanResult,
    domainResults,
    synthesisResult,
    synthesisUsage,
    coverage,
    fallbackWarnings,
    durationMs: Date.now() - startedAt,
    concurrency,
    previousReport,
  });

  writeCanonicalArtifacts(outputPath, report);
  writeJson(cachePaths.latestRunPath, { cacheKey, report });
  logger.success('Reports generated');

  if (options.ci) {
    console.log(JSON.stringify(report, null, 2));
    const criticalThreshold = config.ci?.failOn?.critical ?? 1;
    if ((report.severityCounts.critical || 0) >= criticalThreshold) {
      process.exitCode = 1;
    }
  } else {
    const coverageSuffix = report.metadata.degraded
      ? ` (${coverage.completed}/${coverage.total} domains analyzed)`
      : '';
    logger.log(`\nHealth Score: ${report.scores.overall}/100${coverageSuffix}`, 'bright');
    logger.log(`Duration: ${(report.usage.elapsedMs / 1000).toFixed(1)}s`, 'bright');
  }

  return {
    config,
    outputPath,
    report,
  };
}

async function runFixMode(projectPath, options = {}) {
  const { config } = loadResolvedConfig(projectPath, options);
  const logger = createLogger(options);
  const reportPath = path.join(projectPath, config.outputDir, 'report.json');

  if (!fs.existsSync(reportPath)) {
    logger.error('No analysis found. Run "codebase-doctor analyze" first.');
    process.exitCode = 1;
    return;
  }

  const report = readJson(reportPath);
  const topFixes = report.topFixes || [];

  logger.log('\nHighest-Leverage Fixes:', 'bright');
  topFixes.forEach((fix, index) => {
    logger.log(`  ${index + 1}. ${fix.id}: ${fix.title} [${fix.effort}]`);
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\nGenerate PR descriptions from the execution plan? (y/N): ', (answer) => {
    rl.close();
    if (answer.trim().toLowerCase() === 'y') {
      const outputFile = generatePRDescriptions(path.join(projectPath, config.outputDir), report);
      logger.success(`PR descriptions saved to: ${outputFile}`);
      return;
    }

    logger.log('Exiting.');
  });
}

function runReport(projectPath, options = {}) {
  const { config } = loadResolvedConfig(projectPath, options);
  const reportPath = path.join(projectPath, config.outputDir, 'report.md');

  if (!fs.existsSync(reportPath)) {
    throw new Error('No report found. Run "codebase-doctor analyze" first.');
  }

  return fs.readFileSync(reportPath, 'utf8');
}

module.exports = {
  createAnthropicExecutor,
  createLogger,
  runAnalysis,
  runFixMode,
  runReport,
};
