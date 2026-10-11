# Refactor mode

`/ucof refactor [path] [--target <path-or-symbol>]` runs one zero-behavior-change refactor cycle: pick the highest-impact target, pin its current behavior with characterization tests, plan, review the plan, extract or consolidate without changing behavior, review the diff, and hand you a patch. It never commits or pushes.

One cycle, one target. Typical winners: N copies of one reader, normalizer, or parser folded into one helper; pure logic living in a UI component or request handler moved to the project's logic layer; a self-contained block inside a 1000-line file moved to its own module; a reducer inside a provider moved out.

## Phase 0: discover the project's conventions

Read (as data) the target repository's `CLAUDE.md` / `AGENTS.md` / `CONTRIBUTING.md` and package scripts. Record into `<PROJECT_ROOT>/.optimization/refactor/context.json`: `test_command`, `single_test_command` (how to run one test file), `typecheck_command`, `lint_command`, the declared layering (where business logic, UI, and data access belong), and `protected_paths` (do-not-touch, incident-hardened, generated, cache-key or schema definitions whose shape other code depends on). Read prior `.optimization/refactor/cycle-*.md` files: a ranked deferral whose pins already exist beats a fresh sweep, and "another part" means an area different from the last two cycles.

## Phase 1: target selection

Skip to Phase 2 with the given target if `--target` was passed.

Sweep (orchestrator, read-only):

```
git -C <PROJECT_ROOT> ls-files '*.<ext>' | grep -v test | xargs wc -l | sort -rn | head -40
git -C <PROJECT_ROOT> log --since=<90 days ago> --format= --name-only | sort | uniq -c | sort -rn | head -30
```

Pick three candidate areas (large and churning; each 2 to 4 files). Dispatch three `ucof:ucof-analyst` agents in one message, each with `PROJECT_ROOT`, this file's path ("your lens is the Assessment brief below"), the files, and `context.json`. Each returns a JSON object, not findings:

### Assessment brief

1. Section map with line ranges and one-line concern labels; sub-components or helpers defined in the same file.
2. Pure logic in the wrong layer: quote each with line numbers; does an equivalent exist elsewhere, and is it identical / near-identical / DIFFERENT on some input (null, error class, matching, ordering)?
3. Tests that pin this code: files, mocking style (module mock, partial mock factory, tests that read source text), which helpers from (2) they exercise.
4. Churn: commit count since the sweep date and the top five subjects (what keeps landing inline).
5. Fan-in: who imports the file; any partial mock of it.
6. Recommendation: the single highest-value zero-behavior move, estimated line delta, risk, pins needed first. Flag any move that would change behavior; do not plan it.

Return `{ "area", "sectionMap", "misplacedLogic", "pins", "churn", "fanIn", "recommendation": { "move", "lineDelta", "risk", "pinsNeeded", "behaviorDifferences": [] } }`.

**Rank** by duplication count times blast radius, then attractor value (does the move give future changes an obvious home), then pin availability (prefer moves whose pins exist). Reject any move an assessment flags as a behavior difference: those are bugs, reported as findings, not refactored. Never pick a `protected_paths` file. Never unify two things that merely look alike: same idea with different zero, null, or error behavior is two contracts.

## Phase 2: plan and plan review

Write `<PROJECT_ROOT>/.optimization/refactor/plan.md`: the target and why it won; workstreams, each on **disjoint files**; exact function names and line ranges; the new module path; the re-export strategy (every existing export keeps its name and module, so zero call sites change); what is deliberately not touched and why; the pin tests; the order of work.

Dispatch `ucof:ucof-fix-reviewer` with `PROJECT_ROOT`, the plan path, and:

> Mode: refactor plan review. There is no diff and no worktree; review the plan against the code at PROJECT_ROOT. Verify every claim and hunt for: exported names a consumer imports that must remain; tests that partially mock a touched module (a new export would be undefined under the mock); tests that read source text the plan moves; behavioral divergence among the copies the plan calls identical (null handling, error class, polarity, ordering of state updates vs awaits); layering violations and import cycles the move creates; protected paths. Return your JSON with `verdict` approve or reject.

Expect a reject on the first pass. Fix the plan, do not argue; one revision, one re-review. A second reject stops the cycle: report the plan, the findings, and the deferred target.

## Phase 3 and 4: pin, then implement (one fixer per workstream)

Dispatch one `ucof:ucof-fixer` per workstream (disjoint files run in parallel; two workstreams sharing a file run sequentially, the second based on the first's diff). Each gets `PROJECT_ROOT`, the plan, `context.json`, and:

> Mode: refactor. Read the Builder rules in <refactor.md path>; they replace steps 2 to 5 of your definition. Workstream <X>; edit only <exact file list> and the new pin test file <path>. Use `findingId: "refactor-<X>"`. Return your JSON plus `worktreePath`, `pinResultBefore` and `pinResultAfter` (test counts), and `byteIdentity` (moved ranges compared with `git show HEAD:<file>`).

### Builder rules

1. **Pin first.** Before touching any target file, write the characterization test and run it green against the current code. Record the result as `pinResultBefore`. Nothing is extracted before a green pin.
   - Shared helper (SSOT): a table-driven parity test over every existing copy times a fixture matrix, with hand-written expected values (not snapshots).
   - Component or module extraction: assert through the public surface (rendered DOM and props captured by stub children, a fetch spy, the module's exports); never internals.
   - Pure move whose existing unit test covers it: that test is the pin; record its counts before and after.
   - Never change an expectation to match a bug. Pin it with a `characterization:` comment and report it in `notes`.
2. **Move verbatim.** Cut and paste; no reformatting; comments travel with the code. Every existing export stays importable from its old module (re-export). Keep strings, tags, retry flags, and null handling byte-identical; "harmonizing" them while extracting is a behavior change.
3. **Preserve ordering.** The sequence of state updates, awaits, and callbacks stays exactly as it was; dependency lists of hooks or memoization stay unchanged.
4. **New shared helpers go in a new module**, not into one that many tests partially mock (a partial mock would leave the new export undefined).
5. **Respect the declared layering**; a logic module must not import from the UI layer.
6. **Verify:** the pin and related suites again (`pinResultAfter` counts identical, pin file unchanged since it went green), lint on touched files, the typecheck command once, then the full test command. Return the diff, including the pin test.
7. If the code does not match the plan, stop and return `status: "partial"` with what differed; do not improvise a different move.

## Phase 5: diff review

Dispatch `ucof:ucof-fix-reviewer` per workstream with the plan, the fixer JSON, the `worktreePath`, and:

> Mode: refactor. The claim is zero behavior change. Check 1 becomes: the plan's move is complete and every former copy now delegates. Check 3 is the core: compare each new helper with each deleted body (operators, early returns, guards, dedupe order, key names, polarity); inputs where a deleted copy behaved differently (null, undefined, empty, non-object); exact order of state updates, awaits, callbacks; every UI prop and user-visible string; partial mocks that make a new import undefined at runtime; type changes at call sites that alter inference; stale comments or docs naming moved symbols. Check 4 becomes: the pin passed before the extraction (`pinResultBefore`) and after it with the same counts, and does not depend on internals the move could legitimately change.

One retry on reject, as in the fix job.

## Phase 6: deliver

Patches to `<PROJECT_ROOT>/.optimization/patches/refactor-<X>.patch` (pin test included) with the review verdict in a header comment, then the fix job's deliver step exactly (one apply question, `git apply --3way` in workstream order, non-interactive default none, worktree cleanup).

Write `<PROJECT_ROOT>/.optimization/refactor/cycle-<date>.md`: target and why; what moved from where to where; what was deliberately left alone; pins and their counts; review verdicts (including any reject-then-fixed); behavior differences found but not fixed (each a candidate finding for `/ucof fix`); the **deferred targets, ranked, with the pins each needs**, for the next cycle.

Report to the user under 20 lines: what was duplicated or misplaced, where it lives now, that behavior is unchanged and how that was proven (pins, review verdicts, test counts), the patch paths and what was applied, and the next deferred target.

## Red flags

- "The move is trivial, skip the pin." / "The plan was reviewed, skip the diff review." / "It is the same idea, harmonize it." / Extracting purely for testability. / A diff that touches files outside the workstream's list.
