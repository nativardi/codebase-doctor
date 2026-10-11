# Contributing to Codebase Doctor

Thanks for helping. The project rules live in [CLAUDE.md](./CLAUDE.md); the short version:

- **Improve a lens first.** Most analysis improvements belong in `skills/codebase-doctor/references/domains/<domain>.md`. They change the plugin and the CLI together. Prefer editing a lens or an agent prompt over adding orchestration code.
- **One finding schema.** It lives in `skills/codebase-doctor/references/finding-contract.md`; link to it, never restate it.
- **Only `skills/codebase-doctor/` may hold a `SKILL.md`.** A test enforces it.
- **Keep the safety model.** Analysis is read-only outside `.optimization/`; fixes go through worktrees, review, and patches; the tool never commits or pushes.
- **Docs move with behavior.** If docs and behavior disagree, fix one in the same change. Do not thin docs.
- **Prompt changes need numbers.** Re-run against `cli-standalone/test/fixtures/planted-project/` (key: `planted-project.key.json`, scorer: `scripts/score-eval.js`) and record precision, recall, and decoys tripped in `CHANGELOG.md`.

Before opening a pull request:

```bash
cd cli-standalone && npm test
claude plugin validate .
```

Deferred features (interactive REPL, new micro-domains, hybrid static analyzers, token budgeting, a CLI verifier pass) need maintainer agreement before work starts.
