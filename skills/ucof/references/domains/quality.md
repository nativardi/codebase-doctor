# Quality Lens

Hunt for maintainability and correctness-adjacent debt that will cause bugs or slow the next change: untested critical logic, tests that cannot fail, type escapes that hide defects, and structural rot. A finding is a concrete file, test, or construct with a real consequence, such as a payment calculation with no tests or an `as any` cast that masks a null dereference. Taste about naming or formatting is not a finding.

## Where to look first
- Test locations: `test/`, `tests/`, `__tests__/`, `*.test.{js,ts,tsx}`, `*.spec.*`, `test_*.py`, `*_test.go`, `spec/` (RSpec), `cypress/`, `e2e/`, `playwright/`; test runner config (`jest.config`, `vitest.config`, `pytest.ini`, `package.json` scripts).
- Core logic that deserves tests: billing, pricing, permissions, parsers, state machines, date and money handling, migrations, data transforms.
- Type and lint config: `tsconfig.json` (`strict`, `noImplicitAny`), `.eslintrc*`, `eslint.config.*`, `ruff.toml`, `mypy.ini`, `.golangci.yml`, `.prettierrc`, pre-commit config.
- Structure: large files and long functions, `utils/` and `helpers/` dumping grounds, barrel `index.ts` files, feature flag modules.
- Grep patterns: `as any`, `: any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# type: ignore`, `TODO`, `FIXME`, `HACK`, `.only(`, `.skip(`, `xit(`, `setTimeout(` or `sleep(` in tests, `expect(` absent from test bodies, `if (FLAGS.`, `featureFlags`, `console.log(`, `catch {}`.

## How to trace
- Map each core module to the tests that import it; follow test imports to the implementation and confirm the assertions exercise the behavior that matters, not just that code runs.
- Open each suspicious test and read what it asserts. A test with no assertion, a mock asserting its own return value, or a snapshot of an error page proves nothing.
- Follow type escapes to the value they hide: trace the `any` or cast back to the source and forward to the first use that would fail at runtime.
- Build the import graph around suspected cycles by following imports in both directions, and check whether the cycle crosses module or layer boundaries.
- Grep for references to each feature flag and TODO owner before judging them dead or stale; use `git log` on the file to compare dates when history is available.

## Checks
- **Test coverage**: Flag core business logic (money, auth, data transforms) with no automated tests, and CI that does not run the existing suite.
- **Assertion-free tests**: Flag tests that call code but assert nothing, assert only that no exception occurred, or assert against values the test itself constructed.
- **Flaky timing tests**: Flag tests depending on real `setTimeout`, `sleep`, wall-clock time, random data, test ordering, or network access with no fake timers or seeding.
- **Disabled tests**: Flag `.skip`, `.only`, and commented-out tests that leave critical paths uncovered.
- **Type safety**: Flag `any` casts, `as unknown as T`, and non-null assertions that hide real nullable paths; flag `strict` disabled in a typed codebase.
- **Linting and formatting**: Flag projects with no enforced lint or format step, or widespread `eslint-disable` of correctness rules.
- **Circular imports**: Flag import cycles between modules that cause undefined-at-load-time bugs or block code splitting.
- **Dead feature flags**: Flag flags that are permanently on or off in every environment, and code paths behind flags no config can set.
- **Stale TODOs**: Flag TODO and FIXME comments that describe a known defect and have outlived the surrounding code's history.
- **Code smells**: Flag functions of several hundred lines, deep nesting, duplicated logic copied across modules, and swallowed errors.
- **Documentation**: Flag complex or non-obvious algorithms with no explanation, and READMEs whose setup steps no longer work.

## Category slugs
- `missing-tests`
- `assertion-free-test`
- `flaky-test`
- `skipped-test`
- `any-type-escape`
- `unsafe-type-cast`
- `strict-mode-disabled`
- `no-linting`
- `circular-import`
- `dead-feature-flag`
- `stale-todo`
- `long-function`
- `duplicated-logic`
- `missing-docs`

## Severity anchors
- **critical**: Core money, auth, or data-integrity logic that is both untested and demonstrably wrong, or a test suite that passes while masking a live defect.
- **high**: Critical business logic with no tests, type casts that hide a reachable runtime failure, skipped tests covering the main path, CI that does not execute tests.
- **medium**: Flaky or assertion-free tests, strict typing off in a typed codebase, circular imports causing load-order bugs, no lint gate, duplicated logic that has already drifted.
- **low**: Dead flags, stale TODOs, long but correct functions, missing docs on complex helpers, minor style inconsistencies.

## Not a finding here
- `any` or casts in generated code, type declaration shims for untyped third-party modules, or test mocks.
- A `console.log` in a CLI tool, build script, or developer utility where stdout is the interface.
- No tests for trivial glue code, simple getters, config files, or thin wrappers over a tested library.
- A TODO that is recent, linked to a tracked issue, or describes a future enhancement rather than a known defect.
- Long functions that are flat, linear, and well commented, such as routing tables or schema definitions.
- Intentional `.skip` with a linked issue or a documented platform condition, and sleep-based waits in end-to-end tests that poll with a bounded timeout.
