# Plugin vs CLI

Codebase Doctor ships two ways to run the same methodology. The **plugin** (the repository root) is the primary product. The **CLI** (`cli-standalone/`) is a headless alternative for environments without Claude Code. Both read the same domain lenses (`skills/codebase-doctor/references/domains/`), use the same finding contract, and share the same reporter code, so scores, ids, and report formats are identical in shape. They differ in how code is read, whether findings are verified, and whether a fix job exists.

---

## Which should I use?

Use the **plugin** when:

- You have Claude Code. This is the default choice.
- You want findings that have been checked by an independent verifier before they count.
- You want the fix job: verified findings implemented in isolated worktrees, reviewed, and delivered as patches.
- You want to run it in CI and can install Claude Code in the pipeline (`claude -p`).

Use the **CLI** when:

- Claude Code is not available (an environment where you can only run Node and call the Anthropic API).
- You want a plain `codebase-doctor analyze` command with API-key authentication and nothing else to install.
- You want the CLI's hash-based cache and a `.codebase-doctor.config.json` checked into the repository.

If you can run Claude Code headlessly in CI, prefer that over the CLI: the findings are verified, and the same plugin runs locally and in the pipeline.

---

## Capability table

| Capability | Plugin | CLI |
|------------|--------|-----|
| Eight-domain analysis | Yes | Yes |
| Shared lens files and finding contract | Yes | Yes |
| How code is read | Agents trace data flows with Read and Grep | Scanner selects files; contents go into the prompt |
| Verification (adversarial verifier, default refuted) | Yes | No. Findings are unverified |
| Refuted findings kept under `refutedFindings` | Yes | Not applicable |
| Fix job (worktrees, review gate, patches) | Yes (`/codebase-doctor fix`) | No. `codebase-doctor fix` prints top fixes and writes `pr-descriptions.md` |
| Cleanup job (dead code, duplicates, deps; worktrees, review gate, patches) | Yes (`/codebase-doctor cleanup`) | No |
| Refactor job (pinned zero-behavior-change cycle) | Yes (`/codebase-doctor refactor`) | No |
| Stable finding ids | Yes | Yes |
| Health score and execution plan | Yes (shared reporter code) | Yes |
| Trend vs previous run | Yes | Yes |
| HTML report | Yes | Yes |
| Markdown, JSON, and execution-plan reports | Yes | Yes |
| CI | Yes, `claude -p --plugin-dir ... "/codebase-doctor analyze ."`, then read `report.json` | Yes, `--ci`: JSON on stdout and severity-based exit codes |
| Caching | No | Yes, hash-based, `--force` to bypass |
| Config file | No (skill arguments) | Yes, `.codebase-doctor.config.json` |
| Domain selection | `--domains security,data` | Config |
| Model selection | Fixed in agent definitions | Configurable (`models`), with fallback chain |
| Cost estimates | Not reported | Per-model `pricing` table |
| Authentication | Your Claude Code plan or API key | `ANTHROPIC_API_KEY` |
| Writes outside `.optimization/` | Only on your explicit choice, in fix mode | Never |

---

## Cost and time

Cost and duration depend on repository size and on the model mix. There are no fixed figures to quote.

- **Plugin.** Runs on your Claude Code plan or API key. The scout uses Haiku, most analysts use Sonnet, security and external analysts and all verifiers use Opus. Verification adds Opus calls, which is the price of verified findings. `--domains` narrows a run.
- **CLI.** Uses an Anthropic API key directly and bills tokens against it. The model ids are configurable, and the `pricing` table in the config drives the cost estimate it prints.

---

## Plugin

### Installation

For a single session:

```bash
git clone https://github.com/nativardi/codebase-doctor.git
claude --plugin-dir /path/to/codebase-doctor
```

Through the marketplace (the repository is its own single-plugin marketplace):

```bash
claude plugin marketplace add nativardi/codebase-doctor
claude plugin install codebase-doctor@codebase-doctor
```

### Use

```
/codebase-doctor                                   # analyze the current directory
/codebase-doctor analyze ../other-repo             # analyze another path
/codebase-doctor analyze . --domains security,data
/codebase-doctor fix                               # implement verified findings
/codebase-doctor fix --ids SEC-3ac440
```

Argument form: `/codebase-doctor [analyze|fix] [path] [--domains security,data] [--ids SEC-3ac440,...]`. The skill is user-invoked only; Claude will not start it on its own.

### CI

```bash
claude -p --plugin-dir /path/to/codebase-doctor "/codebase-doctor analyze ."
jq '.scores.overall' .optimization/report.json
```

`-p` is print mode: Claude Code runs non-interactively and exits. Analysis asks no questions, so it suits unattended runs. Do not run `fix` unattended; it asks which findings to fix and whether to apply patches. For permission handling in non-interactive runs (`--permission-mode`), see the Claude Code documentation.

### What it needs

Claude Code, git (the fix job uses worktrees), and `node` on the PATH (the renderer is a Node script). No `npm install` is required for the plugin itself.

---

## CLI

### Installation

```bash
git clone https://github.com/nativardi/codebase-doctor.git
cd codebase-doctor/cli-standalone
npm install
npm link                      # optional: puts `codebase-doctor` on your PATH
export ANTHROPIC_API_KEY="your-key"
```

Requires Node.js 18 or newer.

### Use

```bash
codebase-doctor analyze /path/to/project
codebase-doctor analyze /path/to/project --ci          # JSON on stdout, exit codes
codebase-doctor analyze /path/to/project --force       # bypass the cache
codebase-doctor report /path/to/project
```

Everything else (flags, config file, GitHub Actions, troubleshooting) is in [cli-standalone/README.md](./cli-standalone/README.md).

### Limits to know about

- Findings are **unverified**. Treat the CLI's output as candidates; the plugin's verifier is what filters false positives.
- `codebase-doctor fix` only prints the top fixes and writes `pr-descriptions.md`. The real fix job is in the plugin.
- The CLI sends selected file contents to the model, bounded by `promptLimits`, so very large repositories are sampled rather than read in full. The plugin's agents explore with Read and Grep.

---

## Migrating from v2

v2 had two products: a "Skill" that was a paste-this-URL prompt (`SKILL.md`) and the CLI. In v3:

- **The paste-URL skill is gone.** `Read https://raw.githubusercontent.com/.../SKILL.md and analyze ...` no longer works; the root `SKILL.md` and `skill-claude-code/` were removed. Install the plugin instead (see above) and use `/codebase-doctor`.
- **Domain skills moved.** `skills/<domain>/SKILL.md` became lens files at `skills/codebase-doctor/references/domains/<domain>.md`. The CLI reads them from there. If you maintained a fork with custom domain prompts, port them to the lens format.
- **Finding ids changed format.** v2 used sequential ids (`SEC-001`). v3 ids are stable hashes (`SEC-a3f9`), so trend diffs between a v2 `report.json` and a v3 one will show everything as new and resolved. Compare v3 runs against v3 runs.
- **`report.json` changed.** `metadata.version` is `3.0.0`, there is a `refutedFindings` array and a `verification` summary.
- **CLI defaults changed.** Model ids are now `claude-haiku-4-5`, `claude-sonnet-5-5`, `claude-opus-5-5`; override them under `models` in `.codebase-doctor.config.json`.
- **Removed docs and files.** `QUICKSTART.md` (folded into the README), `cli-standalone/INSTALL.md` (folded into the CLI README), `READY_TO_PUSH.md`, `cli-standalone/SKILL-ORIGINAL.md`, `cli-standalone/claude-code-prompt.md`, `.agent/`.

CLI commands (`analyze`, `report`, `fix`) and flags (`--ci`, `--force`, `--skip-discovery`, `--concurrency`, `--config`) are unchanged.

---

## Deferred features

These are deliberately out of scope for v3 and will not appear without an explicit decision:

- Interactive REPL mode
- New micro-domains (secrets, CVE, dead-code scanners)
- Hybrid analyzers (running `npm audit`, regex scanners, or static heuristics alongside the models)
- Token budgeting

---

## Related

- [README.md](./README.md): install and quick start
- [METHODOLOGY.md](./METHODOLOGY.md): how the pipeline works and why
- [cli-standalone/README.md](./cli-standalone/README.md): CLI reference
- [CHANGELOG.md](./CHANGELOG.md): release history

---

## Migrating from `/ucof` (v3)

Codebase Doctor 4.0.0 is the former UCOF 3.x renamed. The command is `/codebase-doctor` (was `/ucof`), agents are `doctor-*`, the CLI binary is `codebase-doctor`, the config file is `.codebase-doctor.config.json` (was `.ucof.config.json`), and `UCOF_PATH` became `DOCTOR_PATH`. The `.optimization/` output directory is unchanged.
