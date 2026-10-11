# Codebase Doctor — Project Rules

Instructions for AI assistants working on this repository. The repository root is the Claude Code plugin root.

---

## 1. Layout (what lives where)

- `skills/codebase-doctor/SKILL.md` — the `/codebase-doctor` front desk (analyze, fix, cleanup, refactor). Keep it under 300 lines; detail goes in `references/`.
- `skills/codebase-doctor/references/domains/*.md` — the eight domain lenses. Single source of truth for what each analyst hunts; the CLI reads the same files.
- `skills/codebase-doctor/references/cleanup.md`, `refactor.md` — the cleanup and refactor job procedures (briefs, builder rules, review prompts).
- `skills/codebase-doctor/references/finding-contract.md` — the finding schema, severity table, scoring rule. Single source of truth; never restate it elsewhere, link to it.
- `agents/*.md` — scout, analyst, verifier, fixer, fix-reviewer. Every agent sets an explicit `model:`.
- `scripts/render-report.js` — deterministic rendering (ids, dedupe, score, plan, HTML) built on `cli-standalone/lib/reporter.js`. Scoring and planning live in code, never in prompts.
- `cli-standalone/` — the headless API alternative. Tests live in `cli-standalone/test/`.

**Rule:** Only `skills/codebase-doctor/` may contain a `SKILL.md`. Any other `skills/<x>/SKILL.md` becomes a separately exposed skill. A test enforces this.

---

## 2. HTML Report Design

The HTML report at `cli-standalone/lib/reporter.js` (`generateHtmlFromReport`) has a deliberate aesthetic: dark engineering-blueprint theme, mono typography, ochre accent, semantic severity colors, grid-line background, staggered entry animations.

**Rule:** Before touching HTML/CSS/JS in the report generator, or creating any new UI output, invoke the `frontend-design` skill. Do not add CDN dependencies; the report stays self-contained. Respect the `:root` design tokens.

---

## 3. Documentation Discipline

Docs: `README.md`, `METHODOLOGY.md`, `VERSIONS.md`, `CHANGELOG.md`, `cli-standalone/README.md`, `skills/codebase-doctor/references/methodology.md`.

**Rule:** When documentation conflicts with behavior, fix one to match the other in the same change. Never thin documentation during a refactor: move content or replace it with equal or greater depth.

---

## 4. Test Discipline

**Rule:** Run `cd cli-standalone && npm test` before declaring any change complete. All must pass. New features get tests; bug fixes get a regression test.

**Rule:** After changing `skills/`, `agents/`, or `.claude-plugin/`, run `claude plugin validate .` from the repo root.

---

## 5. Read-Only Analysis, Gated Fixes

Analysis never modifies the analyzed repository outside its `.optimization/` output directory. Scout, analyst, and verifier agents are read-only by tool set.

The fix job may write code, under these constraints: it works in an isolated git worktree, every diff passes the fix-reviewer, patches are written to `.optimization/patches/`, and nothing touches the user's working tree until the user picks which patches to apply. Codebase Doctor never commits, pushes, or opens pull requests.

**Rule:** Do not loosen any of those constraints. Do not add writes to the analyzed project from the analyze job.

---

## 6. Scope Discipline

Deferred features: interactive REPL, new micro-domains (secrets/CVE/dead-code scanners), hybrid static analyzers, token budgeting, a verifier pass in the CLI.

**Rule:** Do not implement deferred features without explicit user approval. Keep changes incremental. Prefer editing a lens or an agent prompt over adding orchestration code.

---

## 7. Validation

`cli-standalone/test/fixtures/planted-project/` holds planted issues and decoys; the key is `cli-standalone/test/fixtures/planted-project.key.json` (kept outside the project so analysts cannot read it). `scripts/score-eval.js <report.json> <key.json>` scores a run.

**Rule:** When changing an agent prompt or a lens, re-run the plugin against the fixture and compare precision, recall, and decoys tripped with the numbers in `CHANGELOG.md`. Record new numbers there.
