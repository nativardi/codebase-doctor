# UCOF — Claude Code Project Rules

Instructions for AI assistants working on this repository.

---

## 1. HTML Report Design

The HTML report at `cli-standalone/lib/reporter.js` (the `generateHtmlFromReport` function) has a deliberate aesthetic — dark engineering-blueprint theme, mono typography, ochre accent, semantic severity colors, grid-line background, staggered entry animations.

**Rule:** Any time you touch HTML/CSS/JS in the report generator — or create any new UI output for UCOF — **invoke the `frontend-design` skill first**. Do not write UI code without it.

**Why:** The report is the product's user-facing surface. Generic styling undermines everything else the tool does well. The skill ensures bold, intentional, production-grade design choices instead of default AI aesthetics.

**How to apply:**
1. Before editing the `generateHtmlFromReport` function, call `Skill → frontend-design:frontend-design`
2. Commit to an aesthetic direction and execute it precisely
3. Do not add CDN dependencies — the report must remain self-contained (inline CSS/JS only)
4. Respect existing design tokens in `:root` CSS variables when making incremental changes

---

## 2. Documentation Discipline

The documentation set (`README.md`, `METHODOLOGY.md`, `VERSIONS.md`, `QUICKSTART.md`, `CHANGELOG.md`, `cli-standalone/README.md`, `SKILL.md`, `skill-claude-code/SKILL.md`) is the product's on-ramp for users.

**Rule:** When documentation conflicts with actual behavior, fix the code to match the docs or fix the docs to match the code — never leave them out of sync.

**Rule:** Never gut documentation during refactors. If content is being moved, move it. If it's being replaced, replace it with equivalent or greater depth. Thin stubs are not acceptable.

---

## 3. SKILL.md Sync

Root `SKILL.md` and `skill-claude-code/SKILL.md` must be byte-identical. The test suite enforces this via hash comparison.

**Rule:** If you edit one, copy it to the other in the same change.

---

## 4. Test Discipline

The CLI tests live under `cli-standalone/test/` and use Node's built-in test runner.

**Rule:** Run `cd cli-standalone && npm test` before declaring any CLI change complete. All must pass.

**Rule:** When adding features, add tests. When fixing bugs, add a regression test.

---

## 5. Read-Only Product Stance

UCOF never modifies analyzed code. Analysis, fix mode, and future interactive modes can explain, prioritize, and preview patches, but must not edit the target repository.

**Rule:** Do not add features that write to the analyzed project beyond the `.optimization/` output directory.

---

## 6. Scope Discipline

UCOF v2.1 deliberately defers several features: interactive REPL, new micro-domains (secrets/CVE/dead-code scanners), hybrid analyzers, plugin discovery, token budgeting.

**Rule:** Do not implement deferred features without explicit user approval. Keep incremental changes incremental.

<!-- CLAUDE-DOCTOR: START -->
## Claude Doctor

**Last audited:** 2026-10-04

**Audit status:** Healthy

**Model guidance**
- **Fable:** Run `cd cli-standalone && npm test` before declaring a CLI change done, and keep both `SKILL.md` copies byte-identical.
- **Opus:** The deferred-features list and the read-only product stance are the boundaries; ask before crossing either.
- **Sonnet:** Invoke `frontend-design` before touching `generateHtmlFromReport`.

**Doctor notes**
- No further action needed.
<!-- CLAUDE-DOCTOR: END -->
