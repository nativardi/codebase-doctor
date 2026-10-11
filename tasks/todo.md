# UCOF v3 — Modernize and package as a Claude Code plugin

Started 2026-10-11. Scope from the user: audit, modernize prompts/agents/orchestration, simplify, validate against the previous version, package as a plugin. Verified assumption: the work is mostly markdown; code touchpoints are limited to a render adapter, lens path, model IDs/pricing, and a stable finding fingerprint.

## Audit findings (what drives the plan)

- Skill version is a paste-this-URL prompt, not a plugin: no frontmatter, no subagents, no tool restrictions. "Use Haiku/Opus" is stated but there is no mechanism (Agent tool) to make it happen.
- Two orchestration engines (SKILL.md and the CLI) plus three copies of the finding contract (root SKILL.md, 8 domain skills, domains/index.js prompt). Root SKILL.md is byte-duplicated into skill-claude-code/.
- No verification step. Unverified findings feed the health score directly; false positives cost score and attention.
- CLI stuffs up to 180k chars of file contents into a single prompt per domain. Agentic tracing (Read/Grep across files) is strictly stronger and is what Claude Code subagents do natively.
- Synthesis prompt asks the model for health_score, dedupe and execution_plan that reporter.js already computes in code and ignores.
- `ucof fix` is a stub (prints top fixes, writes pr-descriptions.md). The user explicitly asked for analysis-to-implementation.
- Finding IDs (SEC-001) are per-run, so trend diffing across runs is meaningless.
- Model IDs in config.js are outdated (claude-sonnet-4-5, claude-opus-4-5); cost uses hardcoded Sonnet rates.
- Repo clutter: READY_TO_PUSH.md, SKILL-ORIGINAL.md, claude-code-prompt.md, INSTALL.md (dup of CLI README), .agent/workflows/optimize.md (hardcoded wrong path), skill-claude-code/.
- Docs: ~2,500 lines across 7 files with heavy overlap and speculative cost tables.

## Decisions

- Repo root becomes the plugin root. Domain lens files move to `skills/ucof/references/domains/` so they are not auto-discovered as 8 separate skills.
- Determinism stays in code: reuse `cli-standalone/lib/reporter.js` for dedupe, scoring, plan, HTML via a thin adapter script. No new infrastructure.
- Orchestration via the Agent tool fan-out in SKILL.md (no Workflow script, no opt-in gate).
- CLAUDE.md rule 5 (read-only) is amended: analysis stays read-only; fix mode writes only on explicit command, on a branch or worktree, and never commits or pushes unless asked. The user's request is the explicit approval rule 6 requires.
- CLI stays as the headless API alternative: model IDs, lens path, pricing only. Recommended CI path becomes headless Claude Code with the plugin.

## Plan

- [x] 1. Move lenses to `skills/ucof/references/domains/*.md`; single `finding-contract.md`; repoint `readSkill`; drop the pasted contract blocks; drop the sync test.
- [x] 2. Render adapter `scripts/render-report.js` (findings JSON -> report.json/md/html/plan) reusing reporter.js; stable finding fingerprint for trend diffing; score only verified findings.
- [x] 3. config.js model IDs + per-model pricing (invoke claude-api skill first).
- [x] 4. Agents: ucof-scout (haiku), ucof-analyst (sonnet; opus for security/external), ucof-verifier (opus), ucof-fixer (sonnet), ucof-fix-reviewer (opus). Explicit model on each. Read-only tool sets for scout/analyst/verifier.
- [x] 5. `skills/ucof/SKILL.md` front desk: analyze | fix | recheck. Parallel Agent fan-out, verification pass, adapter call, concise report to user.
- [x] 6. `.claude-plugin/plugin.json` and `marketplace.json`.
- [x] 7. Planted-issue fixture with answer key and decoys + tiny precision/recall scorer. Run old prompt vs new plugin headlessly; record results.
- [x] 8. Docs: README (+QUICKSTART folded in), VERSIONS as plugin-vs-CLI, METHODOLOGY (+verify/fix phases), CHANGELOG v3.0.0, CLI README (+INSTALL folded in). Delete clutter. Delegate prose to haiku.
- [x] 9. CLAUDE.md update (rules 3, 5, 6; plugin layout).
- [x] 10. `npm test` green with new tests for lens path + adapter.

## Review (2026-10-11)

- Assumption verified: the work was mostly markdown. Code touchpoints: `scripts/render-report.js` (new, 95 lines), `scripts/score-eval.js` (new), stable fingerprint + verification handling + cross-domain dedupe in `reporter.js`, lens path in `domains/index.js`, model ids and pricing in `config.js`, synthesis prompt trimmed. HTML untouched.
- Plugin validated with `claude plugin validate .`; tests 20/20.
- Eval: see CHANGELOG v3.0.0 table. Equal recall to v2 (15/15), zero decoys reported (v2: 1), every finding verified, 30 findings with no cross-lens duplicates after the merge step. Fix job validated end to end on the SQL injection finding.
- Cost: v3 runs longer (8.5 min vs 5.8 min) because of the verifier pass on opus. That is the price of the verification tally.
- Not done / follow-ups: multi-run variance not measured (one run each); `claude plugin eval` suite executed from a clean-path copy (with plugin 3/3, baseline 1/3; harness rejects the repo's parenthesized directory name); CLI has no verifier pass (deferred by decision); samples/ regenerated from the new2 run.
- Environment note: during the run Claude Code auto-updated (2.1.285 to 2.1.296) and the native binary needed its postinstall rerun. The user's zsh `grep` shell function shells out to `claude` and broke with it; `/usr/bin/grep` works.
