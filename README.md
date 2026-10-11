# UCOF - Universal Codebase Optimization Framework

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-blueviolet.svg)](https://claude.ai)
[![Node.js](https://img.shields.io/badge/Node.js%20CLI-18+-green.svg)](https://nodejs.org/)

UCOF is a Claude Code plugin that audits a codebase across eight domains (security, external services, data, backend, frontend, infrastructure, performance, quality). Specialist analyst agents trace data flows through the code, an adversarial verifier tries to refute every finding before it reaches the score, and a deterministic script turns the survivors into a health score, an execution plan, and HTML, Markdown, and JSON reports. A second job, `/ucof fix`, implements verified findings in isolated git worktrees, has each diff reviewed, and hands you patches to apply. UCOF never commits or pushes, and analysis never writes outside `.optimization/`.

A standalone Node CLI (`cli-standalone/`) remains available as a headless alternative that calls the Anthropic API directly, for environments without Claude Code. See [Plugin vs CLI](./VERSIONS.md).

---

## Quick start

### Install the plugin

Pick one.

**For a single session** (no install, good for trying it out):

```bash
git clone https://github.com/nativardi/ucof.git
claude --plugin-dir /path/to/ucof
```

**Permanently, through the marketplace** (the repository is its own single-plugin marketplace):

```bash
claude plugin marketplace add nativardi/ucof
claude plugin install ucof@ucof
```

### Run it

Open Claude Code in the repository you want to audit and run:

```
/ucof
```

`/ucof` is the same as `/ucof analyze .`. The full argument form is:

```
/ucof [analyze|fix] [path] [--domains security,data] [--ids SEC-3ac440,...]
```

The skill is user-invoked only (`disable-model-invocation: true`), so Claude never starts a scan on its own.

### What you get

When the run finishes, Claude prints a short summary: the health score (with the change since the last run), counts by severity, how many findings were verified, refuted, or left unverified, the top three fixes with `file:line`, the systemic patterns, and any coverage caveats such as a domain whose agent failed. The full artifacts are in `.optimization/` (see [Output files](#output-files)).

### First-run walkthrough

1. Run `/ucof` in your repository. Analysis asks you nothing, so you can leave it running.
2. Read the summary Claude prints. Start with the top fixes; they are ordered by severity, then by effort, so quick wins come first.
3. Open the HTML report for the filterable view, or read `.optimization/execution-plan.md` for the phased plan:

```bash
open .optimization/report.html
cat .optimization/execution-plan.md
```

4. Fix findings yourself, or run `/ucof fix` (see [The fix job](#the-fix-job)).
5. Run `/ucof` again. Finding ids are stable across runs, so the report shows what is new, what is resolved, and the score delta.

### Reading the report

- **Health score** is 100 minus a weighted count of findings (see [How it works](#how-it-works)). Roughly: 80 and above is in good shape, 60 to 79 means fix the high-severity items first, below 40 means serious issues.
- **Severity** reflects impact if the finding is real. Uncertainty is expressed separately as `confidence`.
- **Verification** shows whether an independent verifier confirmed, downgraded, or could not check each finding. Refuted findings do not appear in the summary or the score; they are kept in `report.json` under `refutedFindings` for audit.
- **Systemic patterns** are root causes that explain several findings at once (for example "No Safety Net": no tests, no CI, no monitoring). Fixing the pattern is usually worth more than fixing its symptoms one by one.
- **Execution plan** groups work into phases: immediate (critical and quick), foundation, stability, hardening.

### Narrowing a run

```
/ucof analyze . --domains security,data
/ucof analyze ../other-repo
```

### Headless and CI

Claude Code can run the plugin non-interactively. `-p` is print mode:

```bash
claude -p --plugin-dir /path/to/ucof "/ucof analyze ."
```

Then read `.optimization/report.json` in your pipeline (for example `jq '.scores.overall'`). Permission handling in non-interactive mode is configured through Claude Code itself (`--permission-mode`); see the Claude Code documentation. A full GitHub Actions example is in [cli-standalone/README.md](./cli-standalone/README.md#cicd-integration).

### Cost and time

Cost and duration depend on repository size and on the model mix. The plugin runs on your Claude Code plan or API key; the CLI uses an Anthropic API key directly. The scout runs on Haiku, most analysts on Sonnet, security and external-services analysts and all verifiers on Opus. Narrow the run with `--domains` if you want a cheaper pass.

---

## What it analyzes

| Domain | What It Checks |
|--------|----------------|
| **Security** | Auth bypass, IDOR, secrets, XSS, SQL injection, RLS policies |
| **Data** | N+1 queries, unbounded queries, missing indexes, schema issues |
| **Backend** | Input validation, error handling, API design, pagination |
| **External** | AI integrations, workers, retry logic, rate limits |
| **Frontend** | Server vs client components, bundle size, loading states |
| **Infrastructure** | CI/CD, monitoring, health checks, secrets management |
| **Performance** | Polling, caching, query counts, scaling limits |
| **Quality** | Tests, linting, type safety, observability |

Each domain is defined by a lens file in [`skills/ucof/references/domains/`](./skills/ucof/references/domains/): where to look first, how to trace, the checks, category slugs, severity anchors, and what is not a finding. The lens files are the single source of truth for both the plugin and the CLI.

---

## How it works

The analyze pipeline, in order:

1. **Scout** (`ucof-scout`, Haiku, read-only). Detects the stack, entry points, which lenses apply, and the hot files for each lens.
2. **Analysts, in parallel** (`ucof-analyst`, Sonnet; Opus for security and external). One per applicable lens. Each reads its lens and the finding contract, then traces data flows across files with Read and Grep instead of being fed file dumps.
3. **Verifiers, in parallel** (`ucof-verifier`, Opus). One per domain that produced findings. Each tries to refute every finding and returns `confirmed`, `refuted`, or `downgraded`.
4. **Systemic patterns.** The main agent writes the root causes that span domains (No Safety Net, Happy Path Only, Scale Cliff, Untrusted Boundaries, or new ones the evidence supports).
5. **Render.** `scripts/render-report.js` reads `.optimization/run.json`, computes ids, dedupes, scores, plans, and writes the reports.
6. **Report.** A short summary goes to you.

### Verification

Analysis models over-report. A finding that looks plausible but is already handled by a middleware or a framework default costs score and, worse, attention. The verifier defaults to `refuted`: it confirms a finding only after it has read the cited line, seen the problem as described, and failed to locate a mitigation, and it must cite `file:line` for each of those. `downgraded` is the middle ground when the defect is real but the severity is wrong. See the "Why verification" section of [METHODOLOGY.md](./METHODOLOGY.md).

### Health score

The score is computed in code, not by a model: start at 100 and subtract 20 per critical, 10 per high, 3 per medium, and 1 per low finding, with a floor of 0. Only confirmed, downgraded, or unverified findings count. Refuted findings are never scored.

### Stable ids and trends

Each finding gets an id like `SEC-a3f9`, a hash of domain, category, primary file, and enclosing symbol. The id stays the same across runs while the defect stays in the same function, so `/ucof` can diff against the previous `report.json` and report new findings, resolved findings, and the score delta.

---

## The fix job

```
/ucof fix
/ucof fix --ids SEC-3ac440,DB-91bd02
```

`fix` needs a prior analysis (`.optimization/report.json`). Candidates are confirmed or downgraded findings, or unverified findings with high confidence; refuted findings are never candidates.

1. **Select.** One question: pick which findings to fix (the top fixes are preselected). Skipped if you pass `--ids`.
2. **Fix, in parallel.** One `ucof-fixer` (Sonnet) per finding, each in its own isolated git worktree. The fixer repairs the root cause, adds a test, runs the project's tests, and returns a diff. It never commits or pushes.
3. **Review.** A `ucof-fix-reviewer` (Opus, read-only) approves a diff only if the mechanism is removed on every path, the change is targeted, it introduces no new weakness or behavior change, and it is tested. A rejected fix gets one retry with the reviewer's required changes.
4. **Deliver.** Patches are written to `.optimization/patches/<id>.patch`. One final question: apply all approved patches, some, or none. Applying uses `git apply --3way` on your working tree. Nothing is committed.

The read-only stance is preserved: analysis writes only to `.optimization/`; fix mode writes only inside worktrees, and touches your working tree only when you say so.

---

## Output files

Everything lands in `<project>/.optimization/`:

| File | Purpose |
|------|---------|
| `report.json` | Canonical source of truth: findings, `refutedFindings`, `verification` tally, scores, patterns, execution plan, metadata |
| `report.md` | Human-readable dashboard and grouped findings |
| `report.html` | Self-contained HTML report (dark engineering-blueprint theme, no external dependencies) |
| `execution-plan.md` | Prioritized remediation plan |
| `run.json` | The raw run written by the skill and consumed by the renderer |
| `discovery.json` | Scout output: stack, entry points, lenses |
| `patches/<id>.patch` | Fix-job output, one per approved finding |

Compatibility files (`all-findings.json`, `synthesis.json`, `*-findings.json`) are also written by the renderer.

---

## CLI alternative

[`cli-standalone/`](./cli-standalone/README.md) is a Node CLI that calls the Anthropic API directly: `ucof analyze|report|fix`, `--ci` mode with exit codes, hash-based caching, and a `.ucof.config.json`. Use it where Claude Code is not available. Its findings are unverified (it does not run the verifier pass), and `ucof fix` only prints the top fixes and writes `pr-descriptions.md`; the real fix job is in the plugin. Where you can, run the plugin headlessly in CI instead.

```bash
cd cli-standalone && npm install
export ANTHROPIC_API_KEY="your-key"
node ucof.js analyze /path/to/your/project
```

---

## Project layout

```
ucof/
├── .claude-plugin/
│   ├── plugin.json              # Plugin manifest (name: ucof, version 3.0.0)
│   └── marketplace.json         # Makes the repo its own single-plugin marketplace
├── skills/ucof/
│   ├── SKILL.md                 # The /ucof skill (analyze and fix jobs)
│   └── references/
│       ├── finding-contract.md  # Single finding schema
│       ├── methodology.md       # Condensed methodology the skill reads
│       └── domains/             # Eight lens files, shared with the CLI
├── agents/
│   ├── ucof-scout.md            # Haiku, read-only discovery
│   ├── ucof-analyst.md          # Sonnet (Opus for security/external), one per lens
│   ├── ucof-verifier.md         # Opus, tries to refute each finding
│   ├── ucof-fixer.md            # Sonnet, isolated worktree
│   └── ucof-fix-reviewer.md     # Opus, read-only review gate
├── scripts/
│   └── render-report.js         # Deterministic rendering of run.json
├── cli-standalone/              # Headless API alternative
│   ├── ucof.js
│   ├── lib/                     # scanner, config, cache, orchestrator, reporter
│   └── test/                    # node --test suite and fixtures
├── samples/                     # Example outputs
├── .github/workflows/ucof.yml   # CI template (CLI)
├── METHODOLOGY.md
├── VERSIONS.md
├── CHANGELOG.md
└── LICENSE
```

---

## Validation

`cli-standalone/test/fixtures/planted-project/` is a small backend with 15 planted defects and four decoys (code that looks wrong but is mitigated). The answer key lives outside the fixture at `cli-standalone/test/fixtures/planted-project.key.json`. Score any run with:

```
node scripts/score-eval.js <project>/.optimization/report.json cli-standalone/test/fixtures/planted-project.key.json
```

Measured results for v2 versus v3 are in [CHANGELOG.md](./CHANGELOG.md). A `claude plugin eval` suite lives under `evals/`.

## Documentation

- [METHODOLOGY.md](./METHODOLOGY.md): how analysis, verification, scoring, and the fix job work
- [VERSIONS.md](./VERSIONS.md): plugin vs CLI, capability table, installation, migration from v2
- [cli-standalone/README.md](./cli-standalone/README.md): CLI installation, commands, config, CI
- [skills/ucof/references/finding-contract.md](./skills/ucof/references/finding-contract.md): the finding schema
- [CHANGELOG.md](./CHANGELOG.md): release history

---

## Contributing

Issues and pull requests are welcome at [github.com/nativardi/ucof](https://github.com/nativardi/ucof). Most improvements belong in a lens file under `skills/ucof/references/domains/`, which changes both the plugin and the CLI. Before opening a pull request:

```bash
cd cli-standalone && npm test
```

Deferred for now: an interactive REPL, new micro-domains (secrets, CVE, dead-code scanners), hybrid analyzers, and token budgeting.

---

## License

MIT. See [LICENSE](./LICENSE).
