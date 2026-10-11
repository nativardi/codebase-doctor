#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const { runAnalysis, runFixMode, runReport } = require('./lib/orchestrator');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const projectPath = args[1] || process.cwd();
  const concurrencyIndex = args.indexOf('--concurrency');
  const configIndex = args.indexOf('--config');
  const absolutePath = path.resolve(projectPath);
  const options = {
    skipDiscovery: args.includes('--skip-discovery'),
    force: args.includes('--force'),
    ci: args.includes('--ci'),
    configPath: configIndex >= 0 ? args[configIndex + 1] : undefined,
    concurrency:
      concurrencyIndex >= 0 && args[concurrencyIndex + 1]
        ? Number.parseInt(args[concurrencyIndex + 1], 10)
        : undefined,
  };

  if (!fs.existsSync(absolutePath)) {
    console.error(`Project path does not exist: ${absolutePath}`);
    process.exitCode = 1;
    return;
  }

  try {
    switch (command) {
      case 'analyze':
        await runAnalysis(absolutePath, options);
        return;
      case 'fix':
        await runFixMode(absolutePath, options);
        return;
      case 'report':
        console.log(runReport(absolutePath, options));
        return;
      case 'help':
      default:
        console.log(`
Universal Codebase Optimization Framework (UCOF)

Usage:
  ucof analyze <project-path>    Run full analysis
  ucof fix <project-path>        Start fix session (new context)
  ucof report <project-path>     View existing report

Options:
  --skip-discovery    Use cached discovery data
  --concurrency <n>   Limit parallel domain execution
  --force             Bypass analysis cache
  --config <path>     Load a project config file
  --ci                Print canonical JSON to stdout and use CI exit codes

Examples:
  ucof analyze /path/to/my/project
  ucof fix /path/to/my/project
  ucof analyze . --skip-discovery
  ucof analyze . --concurrency 2 --force
  ucof analyze . --ci --config .ucof.config.json
`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

main();
