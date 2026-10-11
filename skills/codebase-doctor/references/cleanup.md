# Cleanup mode

`/codebase-doctor cleanup [path]` is a whole-repository sweep for code that can go: dead code, duplicate logic, legacy shims and finished flags, redundant queries, abandoned files, YAGNI complexity, and unused dependencies. It audits read-only, has every candidate adversarially verified, applies the proven cuts in isolated worktrees, has each diff reviewed, and hands you patches. It never commits or pushes.

"Aggressive but safe": cut hard where a zero-caller proof and a reachability check exist; report, never cut, where they do not. Anything that needs a product or wording decision is reported, not applied and not asked about mid-run.

Not for one feature (use `analyze --domains`) and not for file splits or extractions (use `/codebase-doctor refactor`).

## Phase 0: discover the project's conventions

Before any dispatch, the orchestrator reads (as data, per the operating rules) the target repository's `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md`, the package manifest scripts (`package.json`, `Makefile`, `pyproject.toml`, `Cargo.toml`, ...), and any configured dead-code tool (`knip`, `ts-prune`, `vulture`, `deadcode`, ...). Record into `<PROJECT_ROOT>/.optimization/cleanup/context.json`:

- `test_command`, `typecheck_command`, `lint_command` (null when absent).
- `protected_paths`: files or directories the project marks as do-not-touch, incident-hardened, generated (lockfiles excepted), vendored, or migration history. These are never cut.
- `kill_switched`: features behind an env flag or per-tenant opt-in that is default-off. **Kill-switched is not dead.** A pre-launch feature behind a flag stays.
- `prior_reports`: earlier `.optimization/cleanup/report.md` files. Items they mark refuted or deferred are not re-proposed.

If the scout has not run for this repository, dispatch `codebase-doctor:doctor-scout` first and keep its output; analysts get its `tech_stack`, `structure`, and `entry_points`.

## Phase 1: audit (seven analysts in parallel, read-only)

Dispatch seven `codebase-doctor:doctor-analyst` agents in one message. Each gets `PROJECT_ROOT`, this file's path with the instruction "your lens is the brief named <X> in the Briefs section below; read it and the finding contract in full", the contract path, the scout context, and `context.json`. Pass `model: "opus"` for A, B, C, F; leave D, E, G on the default.

Findings use the [finding contract](finding-contract.md) with `domain: "quality"` and a `category` from the brief. Every finding adds to `rationale` the **evidence line**: the search that proves zero callers (exact pattern and scope), the reachability checks done, and the line count it removes. Recommendation `effort` stays the contract's scale.

**Reachability checklist** (a symbol is dead only when every applicable item is checked): static imports; dynamic imports and string-built paths (`import(\`./${x}\`)`, route builders, `require` of a computed name); framework file-system routing (a route/page file is reachable by URL even with zero imports); job, cron, queue, and webhook registrations; manifest and deploy config (`package.json` `bin`/`exports`, CI files, container files, platform configs); scripts and docs that instruct operators to run something; tests that pin a public contract; and the public API of a published library (exported from the package entry = live).

Search with `grep -rn` over the whole repository excluding only `.git`, dependency folders, and build output. A shell alias for `grep` may skip ignored files; use the binary path (`/usr/bin/grep`) when the result proves a negative.

### Briefs

| X | Model | Category slugs | Brief |
|---|---|---|---|
| A dead | opus | `dead-code`, `dead-export`, `dead-file`, `dead-route`, `test-only-export` | Adversarial dead-code verifier. Inputs: the configured dead-code tool's output if the project already runs one (read its last output or config; do not install anything), plus your own scan of every exported function/class/const for zero non-test references, every route file with at most one textual reference, and module-private top-level declarations with zero uses in their own file (residue of earlier export purges). Verdict per item: DEAD / LIVE / TEST-ONLY. A shared constant whose comment says "import this everywhere" that nobody imports is a fix (wire it), not a delete. |
| B dup | opus | `duplicate-logic`, `duplicate-constant`, `hand-rolled-primitive` | Repeated constants, regexes, thresholds; parallel implementations (two parsers, two matchers, retry/sleep/slugify/error-message copies); hand-rolled copies of the project's own primitives and helpers; copy-pasted handler bodies; duplicated test fixtures. Only true duplicates with the same contract. Name every similar pair that is legitimately different and why (null handling, error class, ordering). Rank by lines saved times low risk; mechanical first. |
| C legacy | opus | `finished-flag`, `dead-flag`, `migration-shim`, `compat-branch`, `deprecated-unused` | Table of every environment variable and feature flag: where set or documented, default, reachable branch; classify live switch / documented kill-switch / rollout finished / dead. Then: a successor at 100% whose fallback cannot fire; shims for a migration already applied; compat branches for data shapes that no longer exist; `@deprecated` with zero callers; v1 kept after v2. Wire identifiers (webhook headers, app ids, stored keys) are never renamable. Each item: delete now / delete after the owner confirms <exact check> / keep. |
| D queries | sonnet | `redundant-query`, `n-plus-one`, `over-invalidation`, `self-http-call` | Same data fetched twice for one screen or request; server-prefetched vs client cache-key mismatches; over-broad cache invalidation and idle polling; N+1 and duplicate lookups per request; internal HTTP calls to the app's own API from server code; batchable vendor calls. Confidence high or medium only; no speculative micro-optimizations. List items a prior report already handled. |
| E files | sonnet | `abandoned-file`, `stale-script`, `unreferenced-asset`, `tracked-ignored`, `stale-test` | Finished planning docs; zero-reference one-off scripts (archive, and fix doc paths that point at them); unreferenced static assets; tracked files matched by `.gitignore`; tracked tool logs and strays; tests that mock paths that no longer exist, todo-only test files, unreferenced fixtures. Never propose deleting migrations or specs. Give references and `git log -1 --format=%cs` per file. |
| F complexity | opus | `yagni`, `stdlib`, `native`, `shrink` | Report-only. Single-implementation interfaces, factories with one product, options nobody passes (prove with every call site), delegate-only wrappers; hand-rolled stdlib or platform features; repeated try/catch or validation blocks that a local helper would shrink; lint-disable clusters. Read each candidate; at most 40; estimate net lines. No file splits (refactor mode owns them). |
| G deps | sonnet | `unused-dependency`, `misplaced-dependency`, `undeclared-dependency`, `duplicate-purpose-dependency` | Every declared dependency: import counts (app vs scripts/tests), purpose, verdict (keep / remove / move to dev / declare / replace with built-in). Tool-only usage (config files for build, lint, test tools) counts as used. Bare imports not in the manifest: declare, pinned to the lockfile version. Read import sites for suspected duplicate-purpose pairs. |

## Phase 2: verify

Group findings by brief and dispatch one `codebase-doctor:doctor-verifier` per non-empty group in one message, with the findings and: "Cleanup mode: a dead-code claim is confirmed only if your own search and the reachability checklist in <cleanup.md path> find no live use; a duplicate claim only if the two contracts are identical on every input you can construct." Merge verdicts as the analyze job does. Refuted items are kept in the report, never applied.

Write `<PROJECT_ROOT>/.optimization/cleanup/findings.json` (all findings with verification).

## Phase 3: select

Candidates: confirmed or downgraded findings from A, B, C (delete-now only), D, E, G. F is always report-only. Never a candidate, whatever the verdict:

- anything under `protected_paths` or behind a `kill_switched` flag;
- a feature still reachable from the UI or a public route (deleting it is a product decision);
- visible copy or layout changes, response shape or status changes;
- file splits and extractions (refactor mode);
- schema or migration changes.

Group candidates into **slices with disjoint file sets** (one slice per brief by default; split a large slice by directory). Ask one AskUserQuestion, multi-select, listing slices as "<slice> - N items, ~L lines, files: <top dirs>". Non-interactive default: every slice whose items are all `high` confidence.

## Phase 4: apply (fixers in worktrees)

Dispatch one `codebase-doctor:doctor-fixer` per slice (at most four at once), each with `PROJECT_ROOT`, the slice's findings, `context.json`'s commands, and:

> Mode: cleanup. Read the Builder rules in <cleanup.md path>; they replace steps 4 and 5 of your definition. Edit only these files and the tests that cover them: <slice file list>. Use `findingId: "<slice name>"`. Return your JSON plus `worktreePath` and `itemsSkipped: [{title, reason}]`.

### Builder rules

1. **Re-verify every claim before editing.** Run your own zero-caller search and the reachability checklist. Audits overstate; if a claim is wrong, skip the item and say why.
2. **Zero behavior change.** Responses, status codes, headers, rendered text, and layout stay byte-identical. Cache or query keys keep their shape. A formatter or helper swap needs a check proving identical output on representative inputs (0, 1, a fraction, a large number, a negative, null).
3. **Merge only identical contracts.** Before merging two schemas, parsers, or helpers, diff defaults, coercion, transforms, refinements, enum lists, null handling, and error class. Any difference: skip and report.
4. **Shared helpers go next to the existing primitive** of the same kind, as dependency-free leaf modules when both runtime-restricted and normal code import them, or when a test mocks the obvious home. Watch for import cycles.
5. **Deleting a symbol** also removes its now-orphaned tests, mocks, and doc references in the same slice; a test that pinned a public contract is a sign the symbol is not dead (stop and skip).
6. **Dependencies:** edit the manifest and update the lockfile with the package manager's lockfile-only mode where it has one; never install from the network otherwise.
7. **Verify:** run the tests covering every touched module, then the project's lint and typecheck commands (from the dispatch), then the full test command. All pre-existing results must hold; a new failure means fix or drop the item. No tests added for pure deletions; the existing suite passing is the evidence.
8. Name any behavior change you could not avoid in `notes`; the reviewer will reject it unless it is the removal itself.

## Phase 5: review

Dispatch `codebase-doctor:doctor-fix-reviewer` per slice in parallel with the slice findings, the fixer JSON, the `worktreePath`, and:

> Mode: cleanup. Check 4 becomes: the project's existing tests, lint, and typecheck pass after the change, and no test assertion that guarded a safety property was weakened or deleted. Also hunt for: a deleted symbol still referenced (dynamic import, string path, job registration, test mock, doc or help text naming it); a deleted route reachable by an external client; a behavior change hidden in a deletion (a removed catch changes what a caller receives); merged schemas or helpers that were not identical; cache-key drift; conditional fetching that leaves a consumer assuming loaded data.

On reject, one retry with `requiredChanges`, as in the fix job.

## Phase 6: deliver

Patches to `<PROJECT_ROOT>/.optimization/patches/cleanup-<slice>.patch` with the review verdict in a header comment. Then the fix job's deliver step exactly (one apply question, `git apply --3way`, non-interactive default none, worktree cleanup).

Write `<PROJECT_ROOT>/.optimization/cleanup/report.md`:

0. Headline: lines removed per slice (`git diff --shortstat` per patch), files deleted, dependencies removed.
1. Per item: status APPLIED / APPLIED-PARTIAL / SKIPPED (why) / REFUTED / REPORT-ONLY / NEEDS-DECISION (exact question for the owner) / MEASURE-FIRST.
2. Complexity (F) findings, ranked by net lines.
3. Behavior changes, if any survived review.
4. Still deferred: everything not applied, so the next run does not re-propose it.

Report to the user under 20 lines: lines cut per slice, review verdicts, patch paths, what was applied, and the owner decisions list.

## Red flags

- "The audit said it is dead": only the fixer's own search plus the reachability checklist makes it dead.
- "Behind a flag, so legacy": default-off is not dead.
- "I will split this file while I am here": no; note it for `/codebase-doctor refactor`.
- "It is the same idea": two helpers with different null or error behavior are not duplicates.
- A diff touching files outside the slice's list.
