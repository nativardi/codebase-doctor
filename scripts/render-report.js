#!/usr/bin/env node
// Turns a Codebase Doctor run file (written by the plugin skill) into the canonical artifacts:
// report.json, report.md, report.html, execution-plan.md, plus compatibility files.
//
// Usage: node scripts/render-report.js <project-path> [run-file] [--output-dir .optimization]
//
// Run file shape (all keys optional except domainResults):
// {
//   "discovery": { "project_name": "...", "tech_stack": {...}, ... },
//   "domainResults": [ { "domain": "security", "status": "completed", "model": "opus", "findings": [ ...contract... ] } ],
//   "systemicPatterns": [ { "id": "SYS-001", "name": "...", "description": "...", "severity": "high", "contributing_findings": [], "recommendation": "..." } ],
//   "skippedFiles": [ { "path": "...", "reason": "..." } ],
//   "startedAt": "2026-10-11T10:00:00Z"
// }
const fs = require('fs');
const path = require('path');

const { readJson, writeJson } = require('../cli-standalone/lib/cache');
const { loadResolvedConfig, resolveProjectPaths, DOMAIN_ORDER } = require('../cli-standalone/lib/config');
const { buildCanonicalReport, writeCanonicalArtifacts } = require('../cli-standalone/lib/reporter');

function main() {
  const args = process.argv.slice(2);
  const projectPath = path.resolve(args[0] || process.cwd());
  const outputDirIndex = args.indexOf('--output-dir');
  const outputDir = outputDirIndex >= 0 ? args[outputDirIndex + 1] : undefined;
  const runFile = path.resolve(args[1] && !args[1].startsWith('--') ? args[1] : path.join(projectPath, outputDir || '.optimization', 'run.json'));

  if (!fs.existsSync(runFile)) {
    throw new Error(`Run file not found: ${runFile}`);
  }

  const run = readJson(runFile);
  const { configPath, config } = loadResolvedConfig(projectPath, { outputDir });
  const paths = resolveProjectPaths(projectPath, config);
  const previousReport = readJson(paths.canonicalReportPath, null);
  const domainResults = (run.domainResults || []).map((result) => ({
    status: 'completed',
    usage: {},
    warnings: [],
    ...result,
    findings: result.findings || [],
  }));
  const relevant = run.relevantDomains || DOMAIN_ORDER.filter((domain) => domainResults.some((result) => result.domain === domain));
  const coverage = {
    completed: domainResults.filter((result) => result.status === 'completed').length,
    total: relevant.length,
  };
  const startedAt = run.startedAt ? Date.parse(run.startedAt) : Date.now();

  const report = buildCanonicalReport({
    projectPath,
    config,
    configPath,
    discoveryData: run.discovery || { project_name: path.basename(projectPath) },
    discoveryUsage: {},
    scanResult: { manifest: { skippedFiles: run.skippedFiles || [] } },
    domainResults,
    synthesisResult: { systemic_patterns: run.systemicPatterns || [] },
    synthesisUsage: {},
    coverage,
    fallbackWarnings: run.warnings || [],
    durationMs: Math.max(0, Date.now() - startedAt),
    concurrency: run.concurrency || relevant.length,
    previousReport,
  });

  fs.mkdirSync(paths.outputPath, { recursive: true });
  writeCanonicalArtifacts(paths.outputPath, report);
  writeJson(runFile, run);

  const summary = {
    outputPath: paths.outputPath,
    healthScore: report.scores.overall,
    severityCounts: report.severityCounts,
    verification: report.verification,
    topFixes: report.topFixes.map((fix) => `${fix.id} ${fix.title}`),
    trend: report.trend,
    degraded: report.metadata.degraded,
  };
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
