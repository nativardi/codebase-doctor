const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const { runAnalysis } = require('../lib/orchestrator');
const { generateDomainPrompt } = require('../lib/domains');
const { scanProject } = require('../lib/scanner');
const { loadResolvedConfig, DOMAIN_ORDER } = require('../lib/config');

function copyFixture() {
  const sourcePath = path.join(__dirname, 'fixtures', 'smoke-project');
  const destinationPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-doctor-smoke-'));
  fs.cpSync(sourcePath, destinationPath, { recursive: true });
  return destinationPath;
}

function createFakeExecutor(calls) {
  return async function executeTask(task) {
    calls.push(task);

    if (task.kind === 'discovery') {
      return {
        data: {
          project_name: 'smoke-project',
          tech_stack: {
            frontend: ['express'],
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
            by_extension: {
              js: 3,
              md: 1,
            },
          },
          critical_files: [{ path: 'package.json', reason: 'project manifest' }],
          immediate_concerns: [],
        },
        usage: {},
      };
    }

    if (task.kind === 'domain') {
      return {
        data: [
          {
            id: `${task.domain.slice(0, 3).toUpperCase()}-001`,
            title: `${task.domain} issue`,
            severity: 'medium',
            category: task.domain,
            evidence: {
              file: 'src/app.js',
              lines: '1-3',
              code_snippet: 'function createApp() {',
            },
            impact: `${task.domain} impact`,
            recommendation: {
              action: `Improve ${task.domain}`,
              effort: 'medium',
              code_example: '',
            },
            tags: [task.domain],
          },
        ],
        usage: {},
      };
    }

    return {
      data: {
        summary: {
          total_findings: 8,
          by_severity: {
            critical: 0,
            high: 0,
            medium: 8,
            low: 0,
          },
          health_score: 76,
        },
        systemic_patterns: [],
        deduplicated_findings: [],
        execution_plan: {
          phase_0_immediate: { findings: [] },
          phase_1_foundation: { findings: [] },
          phase_2_stability: { findings: [] },
          phase_3_hardening: { findings: [] },
        },
      },
      usage: {},
    };
  };
}

test('orchestrator runs all eight domains through the modular pipeline', async () => {
  const projectPath = copyFixture();
  const calls = [];

  const result = await runAnalysis(
    projectPath,
    { silent: true },
    {
      executor: createFakeExecutor(calls),
    },
  );

  const domainCalls = calls.filter((call) => call.kind === 'domain');
  assert.equal(domainCalls.length, 8);
  assert.ok(fs.existsSync(path.join(result.outputPath, 'report.md')));
  assert.ok(fs.existsSync(path.join(result.outputPath, 'discovery.json')));
  assert.ok(fs.existsSync(path.join(result.outputPath, 'all-findings.json')));
  assert.ok(fs.existsSync(path.join(result.outputPath, 'synthesis.json')));
});

test('smoke fixture analysis includes real file content in prompts', async () => {
  const projectPath = copyFixture();
  const calls = [];

  await runAnalysis(
    projectPath,
    { silent: true },
    {
      executor: createFakeExecutor(calls),
    },
  );

  const discoveryPrompt = calls.find((call) => call.kind === 'discovery')?.prompt || '';
  const backendPrompt = calls.find((call) => call.kind === 'domain' && call.domain === 'backend')?.prompt || '';

  assert.match(discoveryPrompt, /Small synthetic project used to verify/);
  assert.match(backendPrompt, /function createApp\(\)/);
  assert.match(backendPrompt, /return database\.query\('select \* from users'\);/);
});

test('bounded concurrency caps simultaneous domain execution', async () => {
  const projectPath = copyFixture();
  let activeDomains = 0;
  let maxActiveDomains = 0;

  const executor = async (task) => {
    if (task.kind === 'discovery') {
      return createFakeExecutor([])(task);
    }

    if (task.kind === 'synthesis') {
      return createFakeExecutor([])(task);
    }

    activeDomains += 1;
    maxActiveDomains = Math.max(maxActiveDomains, activeDomains);
    await new Promise((resolve) => setTimeout(resolve, 10));
    activeDomains -= 1;
    return createFakeExecutor([])(task);
  };

  await runAnalysis(projectPath, { silent: true, concurrency: 2 }, { executor });
  assert.equal(maxActiveDomains, 2);
});

test('partial domain failures still produce a degraded report', async () => {
  const projectPath = copyFixture();

  const executor = async (task) => {
    if (task.kind === 'domain' && task.domain === 'performance') {
      throw new Error('performance API unavailable');
    }

    return createFakeExecutor([])(task);
  };

  const result = await runAnalysis(projectPath, { silent: true, concurrency: 3 }, { executor });
  const report = fs.readFileSync(path.join(result.outputPath, 'report.md'), 'utf8');

  assert.match(report, /7\/8 domains analyzed/);
  assert.match(report, /Analysis Unavailable/);
  assert.match(report, /performance API unavailable/);
});

test('progress aggregation reports lifecycle changes', async () => {
  const projectPath = copyFixture();
  const events = [];

  await runAnalysis(
    projectPath,
    {
      silent: true,
      onProgress(domain, state) {
        events.push({ domain, status: state.status });
      },
    },
    { executor: createFakeExecutor([]) },
  );

  const securityEvents = events.filter((event) => event.domain === 'security').map((event) => event.status);
  assert.deepEqual(securityEvents, ['running', 'completed']);
});

test('cache hit, invalidation, and force bypass are deterministic', async () => {
  const projectPath = copyFixture();
  let calls = 0;
  const executor = async (task) => {
    calls += 1;
    return createFakeExecutor([])(task);
  };

  await runAnalysis(projectPath, { silent: true }, { executor });
  const firstRunCalls = calls;

  await runAnalysis(projectPath, { silent: true }, { executor });
  assert.equal(calls, firstRunCalls);

  fs.writeFileSync(path.join(projectPath, 'src', 'app.js'), 'function createApp() { return { routes: ["/changed"] }; }\n');
  await runAnalysis(projectPath, { silent: true }, { executor });
  assert.ok(calls > firstRunCalls);

  const callsBeforeForce = calls;
  await runAnalysis(projectPath, { silent: true, force: true }, { executor });
  assert.ok(calls > callsBeforeForce);
});

test('model fallback warnings are recorded when a preferred model is unavailable', async () => {
  const projectPath = copyFixture();

  const executor = async (task) => {
    if (task.kind === 'domain' && task.domain === 'security' && task.model === 'opus') {
      throw new Error('rate limit exceeded');
    }

    return createFakeExecutor([])(task);
  };

  const result = await runAnalysis(projectPath, { silent: true }, { executor });
  const report = fs.readFileSync(path.join(result.outputPath, 'report.md'), 'utf8');

  assert.match(report, /Model Fallbacks/);
  assert.match(report, /Fell back from opus to sonnet for security/);
});

test('canonical report, execution plan, and compatibility artifacts are generated', async () => {
  const projectPath = copyFixture();
  const result = await runAnalysis(projectPath, { silent: true }, { executor: createFakeExecutor([]) });
  const canonicalReportPath = path.join(result.outputPath, 'report.json');
  const executionPlanPath = path.join(result.outputPath, 'execution-plan.md');
  const canonicalReport = JSON.parse(fs.readFileSync(canonicalReportPath, 'utf8'));

  assert.equal(typeof canonicalReport.metadata.projectName, 'string');
  assert.equal(Array.isArray(canonicalReport.findings), true);
  assert.equal(typeof canonicalReport.scores.overall, 'number');
  assert.equal(typeof canonicalReport.usage.estimatedCostUsd, 'number');
  assert.ok(fs.existsSync(executionPlanPath));
  assert.ok(fs.existsSync(path.join(result.outputPath, 'discovery.json')));
  assert.ok(fs.existsSync(path.join(result.outputPath, 'all-findings.json')));
  assert.ok(fs.existsSync(path.join(result.outputPath, 'synthesis.json')));
  assert.ok(fs.existsSync(path.join(result.outputPath, 'security-findings.json')));
});

test('config file precedence and invalid config handling are deterministic', async () => {
  const projectPath = copyFixture();
  fs.writeFileSync(
    path.join(projectPath, '.codebase-doctor.config.json'),
    JSON.stringify({ concurrency: 1, fileSizeLimitBytes: 64 }, null, 2),
  );

  const result = await runAnalysis(
    projectPath,
    { silent: true, concurrency: 4 },
    { executor: createFakeExecutor([]) },
  );

  assert.equal(result.report.config.concurrency, 4);
  assert.equal(result.report.config.fileSizeLimitBytes, 64);

  const badProjectPath = copyFixture();
  fs.writeFileSync(path.join(badProjectPath, '.codebase-doctor.config.json'), '{not-json');
  await assert.rejects(() => runAnalysis(badProjectPath, { silent: true }, { executor: createFakeExecutor([]) }));
});

test('ci mode emits canonical JSON and sets the expected exit code', async () => {
  const projectPath = copyFixture();
  const originalLog = console.log;
  const output = [];
  console.log = (value) => output.push(String(value));
  process.exitCode = 0;

  try {
    await runAnalysis(
      projectPath,
      { silent: true, ci: true },
      {
        executor: async (task) => {
          if (task.kind === 'domain') {
            return {
              data: [
                {
                  id: `${task.domain.slice(0, 3).toUpperCase()}-001`,
                  title: `${task.domain} critical issue`,
                  severity: 'critical',
                  confidence: 'high',
                  rationale: 'Important issue',
                  evidence: [{ file: 'src/app.js', lineRange: '1-2', codeSnippet: 'function createApp() {' }],
                  impact: 'critical impact',
                  recommendation: { action: 'Fix it', effort: 'low', code_example: '' },
                  fileTargets: ['src/app.js'],
                  relatedFindings: [],
                },
              ],
              usage: {},
            };
          }

          return createFakeExecutor([])(task);
        },
      },
    );
  } finally {
    console.log = originalLog;
  }

  assert.equal(process.exitCode, 1);
  assert.match(output.join('\n'), /"metadata"/);
  process.exitCode = 0;
});

test('plugin layout: every domain has a lens, agents referenced by the skill exist, manifest is valid', () => {
  const root = path.join(__dirname, '..', '..');
  for (const domain of DOMAIN_ORDER) {
    assert.ok(fs.existsSync(path.join(root, 'skills', 'codebase-doctor', 'references', 'domains', `${domain}.md`)), `lens missing: ${domain}`);
  }
  assert.ok(fs.existsSync(path.join(root, 'skills', 'codebase-doctor', 'references', 'finding-contract.md')));

  const skill = fs.readFileSync(path.join(root, 'skills', 'codebase-doctor', 'SKILL.md'), 'utf8');
  const referencedAgents = [...skill.matchAll(/codebase-doctor:(doctor-[a-z-]+)/g)].map((match) => match[1]);
  assert.ok(referencedAgents.length >= 5);
  for (const agent of new Set(referencedAgents)) {
    const agentPath = path.join(root, 'agents', `${agent}.md`);
    assert.ok(fs.existsSync(agentPath), `agent missing: ${agent}`);
    const frontmatter = fs.readFileSync(agentPath, 'utf8').split('---')[1];
    assert.match(frontmatter, /^model: (haiku|sonnet|opus)$/m, `${agent} must set an explicit model`);
  }

  for (const mode of ['cleanup', 'refactor']) {
    assert.ok(fs.existsSync(path.join(root, 'skills', 'codebase-doctor', 'references', `${mode}.md`)), `mode reference missing: ${mode}`);
    assert.ok(skill.includes(`references/${mode}.md`), `SKILL.md does not route ${mode}`);
  }
  assert.ok(skill.split('\n').length < 300, 'SKILL.md must stay under 300 lines');

  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'codebase-doctor');
  const marketplace = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(marketplace.plugins[0].version, manifest.version);
  assert.equal(marketplace.metadata.version, manifest.version);
  // No stray skills: only skills/codebase-doctor may contain a SKILL.md, or the plugin would expose eight extra skills.
  const skillDirs = fs.readdirSync(path.join(root, 'skills')).filter((entry) => fs.existsSync(path.join(root, 'skills', entry, 'SKILL.md')));
  assert.deepEqual(skillDirs, ['codebase-doctor']);
});

test('render-report adapter scores counted findings only and keeps ids stable across runs', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-doctor-render-'));
  const outputPath = path.join(projectPath, '.optimization');
  fs.mkdirSync(outputPath, { recursive: true });
  const finding = (overrides) => ({
    category: 'sql-injection',
    title: 'id concatenated into query',
    severity: 'critical',
    confidence: 'high',
    symbol: 'getUser',
    rationale: 'r',
    evidence: [{ file: 'api/users.js', lineRange: '3', codeSnippet: 'db.query(`...${id}`)' }],
    impact: 'i',
    recommendation: { action: 'parameterize', effort: 'low' },
    ...overrides,
  });
  const run = {
    discovery: { project_name: 'demo' },
    domainResults: [
      {
        domain: 'security',
        model: 'opus',
        findings: [
          finding({ verification: { verdict: 'confirmed', reasoning: 'api/users.js:3' } }),
          finding({ category: 'missing-auth', symbol: 'health', verification: { verdict: 'refuted', reasoning: 'public by design' } }),
          finding({ category: 'idor', symbol: 'list', verification: { verdict: 'downgraded', severity: 'medium', reasoning: 'admin only' } }),
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(outputPath, 'run.json'), JSON.stringify(run));

  const script = path.join(__dirname, '..', '..', 'scripts', 'render-report.js');
  const runScript = () => JSON.parse(execFileSync('node', [script, projectPath], { encoding: 'utf8' }));

  const first = runScript();
  assert.equal(first.healthScore, 77); // 100 - 20 (critical) - 3 (downgraded to medium); refuted not counted
  assert.deepEqual(first.verification, { verified: 2, unverified: 0, refuted: 1 });

  const report = JSON.parse(fs.readFileSync(path.join(outputPath, 'report.json'), 'utf8'));
  assert.equal(report.refutedFindings.length, 1);
  assert.match(report.findings[0].id, /^SEC-[0-9a-f]{6}$/);
  assert.ok(fs.existsSync(path.join(outputPath, 'report.html')));

  const second = runScript();
  assert.deepEqual(second.trend, { scoreChange: 0, newFindings: [], resolvedFindings: [] });

  // Same defect reported by a different lens: id prefix changes, fingerprint does not, trend stays empty.
  run.domainResults[0].domain = 'performance';
  fs.writeFileSync(path.join(outputPath, 'run.json'), JSON.stringify(run));
  const third = runScript();
  assert.deepEqual(third.trend, { scoreChange: 0, newFindings: [], resolvedFindings: [] });
  assert.match(JSON.parse(fs.readFileSync(path.join(outputPath, 'report.json'), 'utf8')).findings[0].id, /^PERF-/);
});

test('new domain prompt contract improves coverage over the old prompt shape', () => {
  const projectPath = copyFixture();
  const scanResult = scanProject(projectPath, { fileSizeLimitBytes: 102400 });
  const { config } = loadResolvedConfig(projectPath, {});
  const discoveryData = {
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
  };

  const oldPrompt = `
Task: Backend Domain Analysis
Project Path: ${projectPath}
Relevant Paths: ["api", "src"]
Return findings with id, title, severity, evidence.file, evidence.lines, evidence.code_snippet, impact, recommendation.
`;
  const newPrompt = generateDomainPrompt('backend', projectPath, discoveryData, scanResult, config).prompt;

  const scorePromptCoverage = (prompt) =>
    ['confidence', 'rationale', 'lineRange', 'codeSnippet', 'category', 'symbol', 'File Context', 'Finding Contract']
      .map((token) => Number(prompt.includes(token)))
      .reduce((sum, value) => sum + value, 0);

  assert.ok(scorePromptCoverage(newPrompt) > scorePromptCoverage(oldPrompt));
});
