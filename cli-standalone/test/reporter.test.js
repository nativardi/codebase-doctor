const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { runAnalysis } = require('../lib/orchestrator');

function copyFixture() {
  const sourcePath = path.join(__dirname, 'fixtures', 'smoke-project');
  const destinationPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ucof-html-'));
  fs.cpSync(sourcePath, destinationPath, { recursive: true });
  return destinationPath;
}

function createExecutor(severity) {
  return async function executeTask(task) {
    if (task.kind === 'discovery') {
      return {
        data: {
          project_name: 'smoke-project',
          tech_stack: {
            frontend: ['node'],
            backend: ['node'],
            database: ['postgresql'],
            queue: 'redis',
            ai_services: ['anthropic'],
            deployment: ['docker'],
          },
          structure: {
            frontend_paths: ['src'],
            backend_paths: ['api', 'src'],
            data_paths: ['api'],
            config_files: ['package.json'],
          },
          quality_indicators: {
            has_tests: true,
            has_ci_cd: false,
            has_linting: false,
            has_typescript: false,
            has_error_monitoring: false,
          },
          file_counts: {
            total: 4,
            by_extension: { js: 3, md: 1 },
          },
          critical_files: [],
          immediate_concerns: [],
        },
        usage: {},
      };
    }

    if (task.kind === 'domain') {
      return {
        data: [
          {
            id: `${task.domain.slice(0, 3).toUpperCase()}-${severity.toUpperCase()}`,
            title: `${task.domain} ${severity} issue`,
            severity,
            confidence: 'high',
            rationale: 'Structured rationale',
            evidence: [{ file: 'src/app.js', lineRange: '1-2', codeSnippet: 'function createApp() {' }],
            impact: 'Structured impact',
            recommendation: { action: 'Fix it', effort: severity === 'critical' ? 'low' : 'medium', code_example: '' },
            fileTargets: ['src/app.js'],
            relatedFindings: [],
          },
        ],
        usage: {},
      };
    }

    return {
      data: {
        summary: {
          total_findings: 8,
          by_severity: { critical: severity === 'critical' ? 8 : 0, high: severity === 'high' ? 8 : 0, medium: severity === 'medium' ? 8 : 0, low: severity === 'low' ? 8 : 0 },
          health_score: severity === 'critical' ? 0 : 60,
        },
        systemic_patterns: [],
      },
      usage: {},
    };
  };
}

test('html report is self-contained', async () => {
  const projectPath = copyFixture();
  const result = await runAnalysis(projectPath, { silent: true }, { executor: createExecutor('medium') });
  const html = fs.readFileSync(path.join(result.outputPath, 'report.html'), 'utf8');

  assert.match(html, /<style>/);
  assert.match(html, /<script>/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('trend diff reports score changes and finding deltas', async () => {
  const projectPath = copyFixture();
  await runAnalysis(projectPath, { silent: true, force: true }, { executor: createExecutor('critical') });
  const secondRun = await runAnalysis(projectPath, { silent: true, force: true }, { executor: createExecutor('medium') });

  assert.ok(secondRun.report.trend.scoreChange > 0);
  assert.ok(secondRun.report.trend.newFindings.length > 0);
  assert.ok(secondRun.report.trend.resolvedFindings.length > 0);
});

test('github actions workflow template references both engines and uploads the report', () => {
  const workflowPath = path.join(__dirname, '..', '..', '.github', 'workflows', 'ucof.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /^name: UCOF$/m);
  assert.match(workflow, /--plugin-dir/);
  assert.match(workflow, /ucof\.js" analyze/);
  assert.match(workflow, /\.optimization\/report\.json/);
});
