# UCOF Changelog

## v3.1.0 - Cleanup and refactor jobs (Current)

Two new jobs on the `/ucof` front desk, both generic for any repository and both under the same gated-write model as `fix`.

- **`/ucof cleanup [path]`** (`skills/ucof/references/cleanup.md`). Seven read-only analysts (dead code, duplicate logic, legacy flags and shims, redundant queries, abandoned files, YAGNI complexity, dependencies) with a reachability checklist and a zero-caller proof per item; findings use the finding contract (`domain: quality`); one verifier pass per brief; candidates grouped into slices with disjoint files; one `ucof-fixer` per slice in its own worktree under cleanup builder rules (re-verify every claim, zero behavior change, merge only identical contracts); every diff reviewed by `ucof-fix-reviewer` with a cleanup hunt list; patches to `.optimization/patches/cleanup-<slice>.patch`; report at `.optimization/cleanup/report.md`. Complexity findings are report-only.
- **`/ucof refactor [path] [--target T]`** (`skills/ucof/references/refactor.md`). One zero-behavior-change cycle: size and churn sweep, three read-only assessments, ranked target, a plan reviewed by `ucof-fix-reviewer` before any code, a characterization pin written and green against the current code before extraction, verbatim moves with re-exports, a diff review focused on behavioral parity, patches to `.optimization/patches/refactor-<X>.patch`, and a cycle note with ranked deferred targets.
- Both discover the project's commands, layering, and protected paths from its own `CLAUDE.md` / `AGENTS.md` / package scripts. No new agents: `ucof-fixer` and `ucof-fix-reviewer` gained a short "modes" clause that defers to the named reference file. Analysis-side agents and lenses are unchanged, so the v3.0.0 eval numbers stand.
- UCOF still never commits, pushes, or opens pull requests.

## v3.0.0 - Claude Code Plugin

UCOF is now a Claude Code plugin whose root is the repository root. The paste-this-URL skill is replaced by a real `/ucof` skill with specialist agents, adversarial verification, and a review-gated fix job. The CLI remains as a headless API alternative.

### Plugin
- **Plugin manifest.** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (plugin name `ucof`, version 3.0.0). The repository is its own single-plugin marketplace: `claude plugin marketplace add nativardi/ucof`, then `claude plugin install ucof@ucof`. For a session: `claude --plugin-dir /path/to/ucof`.
- **The `/ucof` skill** (`skills/ucof/SKILL.md`). Two jobs: `analyze` (default) and `fix`. Arguments: `/ucof [analyze|fix] [path] [--domains security,data] [--ids SEC-3ac440,...]`. `disable-model-invocation: true`, so it runs only when you invoke it.
- **Five agents with explicit models** (`agents/`): `ucof-scout` (Haiku, read-only discovery), `ucof-analyst` (Sonnet; the skill passes Opus for security and external; one per applicable lens, traces data flows with Read and Grep), `ucof-verifier` (Opus), `ucof-fixer` (Sonnet, isolated git worktree), `ucof-fix-reviewer` (Opus, read-only).
- **Analyze pipeline.** Scout, analysts in parallel, verifiers in parallel, systemic patterns written by the main agent, deterministic render, short report to the user.
- **Fix job.** Reads `report.json`; one question to select findings; fixers run in parallel in isolated worktrees; each diff is reviewed, with one retry on rejection; patches are written to `.optimization/patches/<id>.patch`; one question to apply them with `git apply --3way`. It never commits or pushes.

### Verification
- Every finding gets an adversarial verifier pass. Verdicts are `confirmed`, `refuted`, or `downgraded`. The default is refuted, and a verdict must cite `file:line`.
- Refuted findings are kept in `report.json` under `refutedFindings` and never scored. Only confirmed, downgraded, or unverified findings count toward the health score.

### Stable ids and rendering
- **Stable finding ids** (`SEC-a3f9` style): a hash of domain, category, primary file, and enclosing symbol. They stay the same across runs, so trend diffs work.
- **Render adapter** (`scripts/render-report.js`). Reads `.optimization/run.json`, reuses `cli-standalone/lib/reporter.js` for ids, dedupe, health score, per-domain scores, execution plan, top fixes, and trend, and writes `report.json`, `report.md`, `report.html`, and `execution-plan.md`.
- **Single finding contract** (`skills/ucof/references/finding-contract.md`) shared by the plugin and the CLI.

### Lens relocation
- Domain prompts moved from `skills/<domain>/SKILL.md` to lens files at `skills/ucof/references/domains/<domain>.md`. Each lens has: where to look first, how to trace, checks, category slugs, severity anchors, and "not a finding here". The CLI loads the same files, so there is one source of truth.
- Added `skills/ucof/references/methodology.md`, a condensed methodology the skill reads.

### CLI
- Model ids are now `claude-haiku-4-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, configurable under `models` in `.ucof.config.json`.
- New per-model `pricing` table for cost estimates.
- Domain lenses are loaded from `skills/ucof/references/domains/`, and the finding contract is injected into prompts.
- The synthesis prompt asks only for systemic patterns; scoring and planning are in code.
- `max_tokens` is 16000.
- The CLI does not run the verifier pass, so its findings are unverified. `ucof fix` still only prints the top fixes and writes `pr-descriptions.md`.
- `cli-standalone/package.json` version is now 3.0.0.

### Validation and tests
- Planted-issue fixture at `cli-standalone/test/fixtures/planted-project/` (15 planted defects across security, external, data, backend, infrastructure, quality) with an answer key kept outside the fixture at `cli-standalone/test/fixtures/planted-project.key.json`, four decoys (mitigated code that looks wrong, plus a README that tells reviewers to skip a file), and `scripts/score-eval.js` to score a `report.json` for precision and recall.

  Measured on 2026-10-11, headless Claude Code (`claude -p`), one run each:

  | Run | Findings | Planted found | Decoys reported | Verified / refuted | Wall time |
  |-----|----------|---------------|-----------------|--------------------|-----------|
  | v2 paste-URL skill | 30 | 15 / 15 | 1 (dev-only polling script) | none / none | 5m46s |
  | v3 plugin, first pass | 38 | 15 / 15 | 0 | 38 / 0 (8 downgraded) | 9m50s |
  | v3 plugin, with merge step | 30 | 15 / 15 | 0 | 30 / 1 (10 downgraded) | 8m32s |

  The first v3 pass found everything but reported the same defect from two or three lenses (38 findings for about 28 distinct defects). The merge step in the skill and the lens-ownership rule in the analyst brought it back to 30 with no duplicates. Recall is equal; the gains over v2 are zero decoys reported, every finding verified with a cited reason (ten inflated severities corrected, one false claim refuted), stable ids, machine-readable artifacts, and a working fix job. The fix job was validated on the SQL injection finding: parameterized query plus input guard, a new regression test, reviewer approval, patch written to `.optimization/patches/`, nothing committed, 2m43s.

  `claude plugin eval` suite (`evals/analyze-planted`, one run, 2026-10-11): with the plugin 3/3 graders pass (health score reported, SQL injection in the top findings, admin-auth decoy not reported), 27 turns, 7m08s, about $3.04 in API cost. The no-plugin baseline arm scores 1/3 (it finds the SQL injection by hand-reading the 16 files but produces no score, no verification, and no artifacts). The eval harness refuses plugin directories whose names contain parentheses; see `evals/README.md`.
- 20 tests (`cd cli-standalone && npm test`): scanner, orchestrator, reporter, cache, config, CI mode, plugin layout, render adapter, HTML self-containment, trend diff.

### Documentation
- README rewritten around the plugin; `QUICKSTART.md` folded into it.
- METHODOLOGY updated for the v3 pipeline, with new sections "Why verification", "From analysis to implementation", and "Validation".
- VERSIONS.md rewritten as "Plugin vs CLI".
- `cli-standalone/README.md` now opens with a "Plugin or CLI?" note and includes the former `INSTALL.md`.
- Removed the "3-5 minutes" and "$0.50 per run" claims, cost tables, and free-versus-paid comparisons. Cost depends on repository size and model mix; the plugin uses your Claude Code plan or API key, and the CLI uses an API key directly.

### Removed
- Root `SKILL.md` and `skill-claude-code/` (the paste-URL skill)
- `READY_TO_PUSH.md`
- `cli-standalone/SKILL-ORIGINAL.md`
- `cli-standalone/claude-code-prompt.md`
- `INSTALL.md` (`cli-standalone/INSTALL.md`, folded into the CLI README)
- `QUICKSTART.md` (folded into the README)
- `.agent/`

### Breaking changes
- The paste-URL skill no longer exists. Install the plugin and use `/ucof`.
- `skills/<domain>/SKILL.md` moved to `skills/ucof/references/domains/<domain>.md`.
- Finding ids changed format from sequential (`SEC-001`) to stable hashes (`SEC-a3f9`).
- `report.json` has `metadata.version` of `3.0.0`, plus a `refutedFindings` array and a `verification` summary.
- CLI default model ids changed (see above).

### Deferred (unchanged)
- Interactive REPL mode
- New micro-domains (secrets, CVE, dead-code scanners)
- Hybrid analyzers
- Token budgeting

---

## v2.1.0 - Production CLI Rewrite

### CLI Engine Rewrite

The single-file CLI prototype (`ucof.js`) has been replaced with a modular analysis engine:

- **Real project scanner** — Recursively reads files, respects `.gitignore`, skips binaries/oversized files (100KB default), logs skip reasons, builds normalized manifest with SHA-256 file hashes
- **Modular architecture** — CLI internals extracted into `cli-standalone/lib/` (scanner, config, cache, domains, orchestrator, reporter). `ucof.js` is now a thin 74-line entrypoint
- **Bounded parallel execution** — Domains run via `Promise.allSettled()` with configurable concurrency (default 3), replacing the old sequential approach
- **Model fallback chain** — Opus → Sonnet → Haiku. If a preferred model is unavailable, analysis continues with a lower tier and logs a warning
- **Partial failure resilience** — If domains fail, the report still generates with degraded-coverage indicator
- **Smart caching** — Results cached in `.optimization/.cache` keyed by file hashes + config. `--force` bypasses cache
- **Canonical `report.json`** — Single source of truth. `report.md`, `report.html`, and `execution-plan.md` are derived from it
- **Trend diffing** — Compares against previous `report.json` to show new/resolved findings and score delta
- **Config file support** — `.ucof.config.json` with CLI flags > config > defaults precedence
- **CI mode** — `--ci` flag: JSON stdout, no spinners, exit code 1 on configurable severity threshold
- **GitHub Actions template** — Ready-to-use workflow at `.github/workflows/ucof.yml`

### New CLI Flags
- `--ci` — CI-friendly output
- `--force` — Bypass cache
- `--concurrency <n>` — Control parallel domain limit
- `--config <path>` — Custom config file path

### Structured Finding Contract
Domain skill prompts upgraded to require: id, domain, title, severity, confidence, rationale, evidence[] (with file path, line range, snippet), impact, recommendation (action + effort), fileTargets[], relatedFindings[].

### Test Suite
19 tests using Node's built-in test runner covering scanner, orchestrator, reporter, cache, config, CI mode, skill sync, HTML generation, and trend diffing. Includes fixture-based smoke project.

### Breaking Changes
None — existing commands (`analyze`, `report`, `fix`) and `--skip-discovery` remain unchanged.

### Deferred to Future
- Interactive REPL mode (`--interactive`)
- New micro-domains (secrets, dependency-vulns, dead-code, etc.)
- Hybrid analyzers (npm audit, regex scanning, static heuristics)
- Plugin/custom-skill discovery from `.ucof/skills/`
- Token budgeting via `countTokens()`

---

## v2.0.0 - Enhanced Skill with Parallel Analysis

### Major Improvements

#### Skill Version Enhancements
- **Parallel domain analysis** - Analyzes 8 domains in parallel batches (3-5 min total)
- **Intelligent model routing** - Haiku/Sonnet/Opus optimization (same as CLI)
- **Systemic pattern detection** - Identifies cross-cutting issues ("No Safety Net", "Happy Path Only", etc.)
- **Enhanced reporting** - Detailed execution roadmap with Phase 0-3 prioritization

#### Documentation Updates
- **Professional README** - Clear comparison between Skill and CLI versions
- **Optimized SKILL.md** - Complete rewrite with parallel execution strategy
- **Updated VERSIONS.md** - Reflects new Skill capabilities
- **Clean repository** - Removed internal development files

### Technical Details

**Skill Version (SKILL.md):**
```
Phase 1: Discovery (Haiku)
Phase 2: Parallel Analysis
  - Batch 1: Security + External (Opus)
  - Batch 2: Data + Backend (Sonnet)
  - Batch 3: Frontend + Infrastructure + Performance + Quality (Sonnet)
Phase 3: Synthesis (Opus)
Phase 4: Report Generation
```

**Model Usage:**
- Discovery → Haiku (fast, cheap)
- Security & External Services → Opus (critical domains)
- Data, Backend, Frontend, Infrastructure, Performance, Quality → Sonnet (balanced)
- Synthesis → Opus (pattern detection)

**Cost Comparison:**
- Skill: Free (uses Claude subscription)
- CLI: ~$0.50/analysis (direct API calls)

### Breaking Changes
None - fully backward compatible.

### Files Modified
- `SKILL.md` - Complete rewrite with parallel analysis
- `skill-claude-code/SKILL.md` - Synced with root SKILL.md
- `README.md` - Updated comparison table
- `QUICKSTART.md` - Reflects new capabilities
- `VERSIONS.md` - Both versions now have model optimization
- `skill-claude-code/README.md` - Highlights new features
- `.gitignore` - Comprehensive exclusions

### Files Removed
- `SETUP_COMPLETE.md` (internal)
- `PUSH_CHECKLIST.md` (internal)
- `STRUCTURE.md` (internal)

---

## v1.0.0 - Initial Release

### Features
- Basic CLI orchestrator with Anthropic API
- Skill version for Claude Code
- 8 domain analysis
- Basic reporting

---

**Next:** See [README.md](./README.md) for usage instructions.
