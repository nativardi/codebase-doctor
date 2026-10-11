# Codebase Doctor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-blueviolet.svg)](https://claude.ai)
[![Node.js](https://img.shields.io/badge/Node.js%20CLI-18+-green.svg)](https://nodejs.org/)

Codebase Doctor is a Claude Code plugin that audits a codebase across eight domains (security, external services, data, backend, frontend, infrastructure, performance, quality). Specialist analyst agents trace data flows through the code, an adversarial verifier tries to refute every finding before it reaches the score, and a deterministic script turns the survivors into a health score, an execution plan, and HTML, Markdown, and JSON reports. A second job, `/codebase-doctor fix`, implements verified findings in isolated git worktrees, has each diff reviewed, and hands you patches to apply. `/codebase-doctor cleanup` sweeps out dead code, duplicates, legacy flags, and unused dependencies, and `/codebase-doctor refactor` runs one pinned, zero-behavior-change refactor cycle, both through the same worktree, review, and patch gates. Codebase Doctor never commits or pushes, and analysis never writes outside `.optimization/`.

A standalone Node CLI (`cli-standalone/`) remains available as a headless alternative that calls the Anthropic API directly, for environments without Claude Code. See [Plugin vs CLI](./VERSIONS.md).

## Why it is different

- **Verified findings.** Every finding is attacked by an independent verifier that defaults to "refuted" and must cite `file:line` to confirm. Refuted findings never reach your score or your attention.
- **A health score computed in code.** The score, per-domain scores, ids, and execution plan come from a deterministic script, not from a model's mood. The same findings always give the same number.
- **Review-gated patches.** Fixes, cleanups, and refactors are built in isolated git worktrees, reviewed by a separate agent, and delivered as patches you choose to apply.
- **Never commits.** Codebase Doctor does not commit, push, or open pull requests. Analysis writes only to `.optimization/`.

---

## Quick start

### Install the plugin

Pick one.

**For a single session** (no install, good for trying it out):

```bash
git clone https://github.com/nativardi/codebase-doctor.git
claude --plugin-dir /path/to/codebase-doctor
```

**Permanently, through the marketplace** (the repository is its own single-plugin marketplace; the marketplace and the plugin are both named `codebase-doctor`):

```
/plugin marketplace add nativardi/codebase-doctor
/plugin install codebase-doctor@codebase-doctor
```

The same thing from a shell: `claude plugin marketplace add nativardi/codebase-doctor` then `claude plugin install codebase-doctor@codebase-doctor`.

### Run it

Open Claude Code in the repository you want to audit and run:

```
/codebase-doctor
```

`/codebase-doctor` is the same as `/codebase-doctor analyze .`. The full argument form is:

```
/codebase-doctor [analyze|fix|cleanup|refactor] [path] [--domains security,data] [--ids SEC-3ac440,...] [--target path]
```

The skill is user-invoked only (`disable-model-invocation: true`), so Claude never starts a scan on its own.

### Quick start per mode

| You want | Run |
|----------|-----|
| An audit with a health score and plan | `/codebase-doctor` (or `/codebase-doctor analyze .`) |
| Verified findings implemented as patches | `/codebase-doctor fix` (needs a prior analyze) |
| Dead code, duplicates, and unused dependencies removed | `/codebase-doctor cleanup` |
| One safe, behavior-preserving refactor | `/codebase-doctor refactor [--target path]` |

### What you get

When the run finishes, Claude prints a short summary: the health score (with the change since the last run), counts by severity, how many findings were verified, refuted, or left unverified, the top three fixes with `file:line`, the systemic patterns, and any coverage caveats such as a domain whose agent failed. The full artifacts are in `.optimization/` (see [Output files](#output-files)).

### First-run walkthrough

1. Run `/codebase-doctor` in your repository. Analysis asks you nothing, so you can leave it running.
2. Read the summary Claude prints. Start with the top fixes; they are ordered by severity, then by effort, so quick wins come first.
3. Open the HTML report for the filterable view, or read `.optimization/execution-plan.md` for the phased plan:

```bash
open .optimization/report.html
cat .optimization/execution-plan.md
```

4. Fix findings yourself, or run `/codebase-doctor fix` (see [The fix job](#the-fix-job)).
5. Run `/codebase-doctor` again. Finding ids are stable across runs, so the report shows what is new, what is resolved, and the score delta.

### Reading the report

- **Health score** is 100 minus a weighted count of findings (see [How it works](#how-it-works)). Roughly: 80 and above is in good shape, 60 to 79 means fix the high-severity items first, below 40 means serious issues.
- **Severity** reflects impact if the finding is real. Uncertainty is expressed separately as `confidence`.
- **Verification** shows whether an independent verifier confirmed, downgraded, or could not check each finding. Refuted findings do not appear in the summary or the score; they are kept in `report.json` under `refutedFindings` for audit.
- **Systemic patterns** are root causes that explain several findings at once (for example "No Safety Net": no tests, no CI, no monitoring). Fixing the pattern is usually worth more than fixing its symptoms one by one.
- **Execution plan** groups work into phases: immediate (critical and quick), foundation, stability, hardening.

### Narrowing a run

```
/codebase-doctor analyze . --domains security,data
/codebase-doctor analyze ../other-repo
```

### Headless and CI

Claude Code can run the plugin non-interactively. `-p` is print mode:

```bash
claude -p --plugin-dir /path/to/codebase-doctor "/codebase-doctor analyze ."
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

Each domain is defined by a lens file in [`skills/codebase-doctor/references/domains/`](./skills/codebase-doctor/references/domains/): where to look first, how to trace, the checks, category slugs, severity anchors, and what is not a finding. The lens files are the single source of truth for both the plugin and the CLI.

---

## How it works

The analyze pipeline, in order:

1. **Scout** (`doctor-scout`, Haiku, read-only). Detects the stack, entry points, which lenses apply, and the hot files for each lens.
2. **Analysts, in parallel** (`doctor-analyst`, Sonnet; Opus for security and external). One per applicable lens. Each reads its lens and the finding contract, then traces data flows across files with Read and Grep instead of being fed file dumps.
3. **Verifiers, in parallel** (`doctor-verifier`, Opus). One per domain that produced findings. Each tries to refute every finding and returns `confirmed`, `refuted`, or `downgraded`.
4. **Systemic patterns.** The main agent writes the root causes that span domains (No Safety Net, Happy Path Only, Scale Cliff, Untrusted Boundaries, or new ones the evidence supports).
5. **Render.** `scripts/render-report.js` reads `.optimization/run.json`, computes ids, dedupes, scores, plans, and writes the reports.
6. **Report.** A short summary goes to you.

### Verification

Analysis models over-report. A finding that looks plausible but is already handled by a middleware or a framework default costs score and, worse, attention. The verifier defaults to `refuted`: it confirms a finding only after it has read the cited line, seen the problem as described, and failed to locate a mitigation, and it must cite `file:line` for each of those. `downgraded` is the middle ground when the defect is real but the severity is wrong. See the "Why verification" section of [METHODOLOGY.md](./METHODOLOGY.md).

### Health score

The score is computed in code, not by a model: start at 100 and subtract 20 per critical, 10 per high, 3 per medium, and 1 per low finding, with a floor of 0. Only confirmed, downgraded, or unverified findings count. Refuted findings are never scored.

### Stable ids and trends

Each finding gets an id like `SEC-a3f9`, a hash of domain, category, primary file, and enclosing symbol. The id stays the same across runs while the defect stays in the same function, so `/codebase-doctor` can diff against the previous `report.json` and report new findings, resolved findings, and the score delta.

---

## The fix job

```
/codebase-doctor fix
/codebase-doctor fix --ids SEC-3ac440,DB-91bd02
```

`fix` needs a prior analysis (`.optimization/report.json`). Candidates are confirmed or downgraded findings, or unverified findings with high confidence; refuted findings are never candidates.

1. **Select.** One question: pick which findings to fix (the top fixes are preselected). Skipped if you pass `--ids`.
2. **Fix, in parallel.** One `doctor-fixer` (Sonnet) per finding, each in its own isolated git worktree. The fixer repairs the root cause, adds a test, runs the project's tests, and returns a diff. It never commits or pushes.
3. **Review.** A `doctor-fix-reviewer` (Opus, read-only) approves a diff only if the mechanism is removed on every path, the change is targeted, it introduces no new weakness or behavior change, and it is tested. A rejected fix gets one retry with the reviewer's required changes.
4. **Deliver.** Patches are written to `.optimization/patches/<id>.patch`. One final question: apply all approved patches, some, or none. Applying uses `git apply --3way` on your working tree. Nothing is committed.

The read-only stance is preserved: analysis writes only to `.optimization/`; fix mode writes only inside worktrees, and touches your working tree only when you say so.

---

## The cleanup job

```
/codebase-doctor cleanup
```

A whole-repository sweep for code that can go. Seven read-only analysts hunt dead code, duplicate logic, finished flags and migration shims, redundant queries, abandoned files, YAGNI complexity, and unused dependencies; each item carries a zero-caller proof and a reachability check (dynamic imports, file-system routes, job registrations, deploy config, operator docs). A verifier tries to refute each one. You pick which slices (disjoint file sets) to apply; one fixer per slice re-verifies every claim and cuts in its own worktree with zero behavior change; the fix-reviewer gates every diff. Patches land in `.optimization/patches/cleanup-<slice>.patch`, the full report in `.optimization/cleanup/report.md`. Feature deletions still reachable from the UI, copy or response-shape changes, migrations, and anything the project marks protected or kill-switched are reported, never cut. Procedure: [`skills/codebase-doctor/references/cleanup.md`](skills/codebase-doctor/references/cleanup.md).

## The refactor job

```
/codebase-doctor refactor
/codebase-doctor refactor --target src/billing/invoice.ts
```

One zero-behavior-change cycle. A size and churn sweep plus three read-only assessments rank candidate targets (duplicate helpers, logic in the wrong layer, oversized files). The plan is reviewed against the code before anything is written. Then a fixer writes a characterization test, runs it green against the current code, moves code verbatim with re-exports so no call site changes, and reruns the pin with identical counts. The fix-reviewer checks behavioral parity (null handling, error class, ordering of awaits and state updates, partial mocks). You get `.optimization/patches/refactor-<X>.patch` (pin included) and a cycle note with ranked deferred targets for next time. Procedure: [`skills/codebase-doctor/references/refactor.md`](skills/codebase-doctor/references/refactor.md).

---

## Safety model

- Scout, analyst, and verifier agents are read-only by tool set. Analysis writes only inside `<project>/.optimization/` (the directory name is kept for compatibility across versions).
- Fix, cleanup, and refactor work happens in isolated git worktrees. Every diff passes a read-only reviewer before it becomes a patch.
- Patches are written to `.optimization/patches/`. Your working tree changes only when you choose which patches to apply, and the result is an uncommitted change for you to read and test.
- Nothing is ever committed, pushed, or opened as a pull request.
- The skill is user-invoked only, so Claude cannot start a scan, fix, or cleanup on its own.

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

[`cli-standalone/`](./cli-standalone/README.md) is a Node CLI that calls the Anthropic API directly: `codebase-doctor analyze|report|fix`, `--ci` mode with exit codes, hash-based caching, and a `.codebase-doctor.config.json`. Use it where Claude Code is not available. Its findings are unverified (it does not run the verifier pass), and `codebase-doctor fix` only prints the top fixes and writes `pr-descriptions.md`; the real fix job is in the plugin. Where you can, run the plugin headlessly in CI instead.

```bash
cd cli-standalone && npm install
export ANTHROPIC_API_KEY="your-key"
node codebase-doctor.js analyze /path/to/your/project
```

---

## Project layout

```
codebase-doctor/
├── .claude-plugin/
│   ├── plugin.json              # Plugin manifest (name: codebase-doctor, version 4.0.0)
│   └── marketplace.json         # Makes the repo its own single-plugin marketplace
├── skills/codebase-doctor/
│   ├── SKILL.md                 # The /codebase-doctor skill (analyze, fix, cleanup, refactor)
│   └── references/
│       ├── finding-contract.md  # Single finding schema
│       ├── methodology.md       # Condensed methodology the skill reads
│       ├── cleanup.md           # Cleanup job procedure, briefs, builder rules
│       ├── refactor.md          # Refactor job procedure, briefs, builder rules
│       └── domains/             # Eight lens files, shared with the CLI
├── agents/
│   ├── doctor-scout.md            # Haiku, read-only discovery
│   ├── doctor-analyst.md          # Sonnet (Opus for security/external), one per lens
│   ├── doctor-verifier.md         # Opus, tries to refute each finding
│   ├── doctor-fixer.md            # Sonnet, isolated worktree
│   └── doctor-fix-reviewer.md     # Opus, read-only review gate
├── scripts/
│   └── render-report.js         # Deterministic rendering of run.json
├── cli-standalone/              # Headless API alternative
│   ├── codebase-doctor.js
│   ├── lib/                     # scanner, config, cache, orchestrator, reporter
│   └── test/                    # node --test suite and fixtures
├── samples/                     # Example outputs
├── .github/workflows/codebase-doctor.yml   # CI template (CLI)
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
- [skills/codebase-doctor/references/finding-contract.md](./skills/codebase-doctor/references/finding-contract.md): the finding schema
- [CHANGELOG.md](./CHANGELOG.md): release history

---

## Contributing

Issues and pull requests are welcome at [github.com/nativardi/codebase-doctor](https://github.com/nativardi/codebase-doctor). Most improvements belong in a lens file under `skills/codebase-doctor/references/domains/`, which changes both the plugin and the CLI. Before opening a pull request:

```bash
cd cli-standalone && npm test
claude plugin validate .
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the short version and [CLAUDE.md](./CLAUDE.md) for the project rules. Deferred for now: an interactive REPL, new micro-domains (secrets, CVE, dead-code scanners), hybrid analyzers, and token budgeting.

---

## License

MIT. See [LICENSE](./LICENSE).

---

## Migrating from `/ucof` (v3)

Codebase Doctor 4.0.0 is the former UCOF 3.x under a new name. Behavior is unchanged; names are not.

- The command is now `/codebase-doctor` (was `/ucof`); agents are `doctor-*` (were `ucof-*`).
- Reinstall: `/plugin marketplace add nativardi/codebase-doctor`, then `/plugin install codebase-doctor@codebase-doctor`, and remove the old `ucof` plugin.
- CLI: the binary is `codebase-doctor` (was `ucof`), the config file is `.codebase-doctor.config.json` (was `.ucof.config.json`), and `UCOF_PATH` is now `DOCTOR_PATH`.
- Output still goes to `.optimization/`, so existing reports and trend history carry over.
