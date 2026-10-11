# Codebase Doctor CLI - Headless API Alternative

> **Plugin or CLI?** The primary Codebase Doctor product is the Claude Code plugin at the repository root: it verifies every finding with an adversarial verifier and includes a review-gated fix job. This CLI is the **headless API alternative** for environments without Claude Code. It calls the Anthropic API directly. **CLI findings are unverified**, and `codebase-doctor fix` here only prints the top fixes and writes `pr-descriptions.md`. If you can run Claude Code in your pipeline, prefer the plugin, headlessly: `claude -p --plugin-dir /path/to/codebase-doctor "/codebase-doctor analyze ."`. See the [main README](../README.md) and [Plugin vs CLI](../VERSIONS.md).

The CLI shares the domain lenses (`skills/codebase-doctor/references/domains/`), the finding contract, and the reporter with the plugin, so ids, scores, and report formats have the same shape.

---

## Installation

### Prerequisites

| Requirement | Version | Get It |
|-------------|---------|--------|
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| npm | 8+ | Comes with Node.js |
| Anthropic API key | n/a | [console.anthropic.com](https://console.anthropic.com/account/keys) |

### Step 1: Clone and install

```bash
git clone https://github.com/nativardi/codebase-doctor.git ~/codebase-doctor
cd ~/codebase-doctor/cli-standalone
npm install
```

The CLI loads its lens files from `skills/codebase-doctor/references/domains/` in the same repository, so keep the CLI inside a full clone rather than copying `cli-standalone/` alone. Set `DOCTOR_PATH` to the repository root if you move it.

### Step 2: Get an API key

Create a key at https://console.anthropic.com/account/keys. The CLI uses the API key directly and bills tokens against it; cost depends on repository size and the model mix you configure.

### Step 3: Set the key

```bash
# Temporary (current terminal session only)
export ANTHROPIC_API_KEY="sk-ant-your-key-here"

# Permanent (add to ~/.zshrc or ~/.bashrc)
echo 'export ANTHROPIC_API_KEY="sk-ant-your-key-here"' >> ~/.zshrc
source ~/.zshrc
```

Verify:

```bash
echo $ANTHROPIC_API_KEY   # should start with sk-ant-
```

### Step 4: Make the command convenient (optional)

Alias:

```bash
alias codebase-doctor='~/codebase-doctor/cli-standalone/codebase-doctor.js'
```

Or link it globally:

```bash
cd ~/codebase-doctor/cli-standalone
npm link
codebase-doctor --help
```

To remove the link: `npm unlink -g codebase-doctor`. To uninstall entirely, unlink and delete the clone.

You should see:

```
Codebase Doctor

Usage:
  codebase-doctor analyze <project-path>    Run full analysis
  codebase-doctor fix <project-path>        Start fix session (new context)
  codebase-doctor report <project-path>     View existing report
```

---

## Analyze a project

```bash
codebase-doctor analyze /path/to/your/project
```

Without the alias: `node ~/codebase-doctor/cli-standalone/codebase-doctor.js analyze /path/to/your/project`. Results are written to `/path/to/your/project/.optimization/`.

```bash
cat ~/my-app/.optimization/report.md           # Markdown report
open ~/my-app/.optimization/report.html        # HTML report
cat ~/my-app/.optimization/execution-plan.md   # Fix plan
cat ~/my-app/.optimization/report.json         # Canonical JSON
```

---

## Commands and flags

```bash
# Full analysis (creates .optimization/)
codebase-doctor analyze /path/to/project

# View an existing report
codebase-doctor report /path/to/project

# Print the top fixes and write pr-descriptions.md (does not edit code)
codebase-doctor fix /path/to/project

# Re-analyze with cached discovery
codebase-doctor analyze /path/to/project --skip-discovery

# Flags
codebase-doctor analyze /path/to/project --ci               # CI mode: JSON stdout, exit codes
codebase-doctor analyze /path/to/project --force            # Bypass cache, force fresh analysis
codebase-doctor analyze /path/to/project --concurrency 5    # Parallel domain limit (default: 3)
codebase-doctor analyze /path/to/project --config ./my.json # Custom config file

# Help
codebase-doctor --help
```

| Command | What it does |
|---------|--------------|
| `codebase-doctor analyze <path>` | Run full analysis, save to `.optimization/` |
| `codebase-doctor report <path>` | Display the existing report |
| `codebase-doctor fix <path>` | Print top fixes, write `pr-descriptions.md`. Does not implement fixes; use the plugin's `/codebase-doctor fix` for that |
| `codebase-doctor analyze <path> --skip-discovery` | Re-run with cached tech detection |

---

## Output files

After `codebase-doctor analyze`, the project has a `.optimization/` folder:

```
your-project/
└── .optimization/
    ├── report.json            # Canonical source of truth
    ├── report.md              # Human-readable dashboard (start here)
    ├── report.html            # Self-contained HTML with filters
    ├── execution-plan.md      # Prioritized fix plan
    ├── synthesis.json         # Systemic patterns
    ├── all-findings.json      # Raw findings from all domains
    ├── discovery.json         # Tech stack detection
    ├── [domain]-findings.json # Individual domain results
    └── .cache/                # Hash-based re-run cache
```

`report.json` is canonical; the other artifacts derive from it. `metadata.version` is 4.0.0. Because the CLI has no verifier pass, `report.json` has no refuted findings and every finding is marked unverified.

---

## Config file

Place `.codebase-doctor.config.json` at the project root, or pass `--config <path>`. Precedence: CLI flags, then config file, then built-in defaults.

```json
{
  "concurrency": 3,
  "fileSizeLimitBytes": 102400,
  "outputDir": ".optimization",
  "ci": { "failOn": { "critical": 1 } },
  "models": {
    "haiku": "claude-haiku-4-5",
    "sonnet": "claude-sonnet-5-5",
    "opus": "claude-opus-5-5"
  },
  "pricing": {
    "claude-haiku-4-5": { "input": 1, "output": 5 },
    "claude-sonnet-5-5": { "input": 2, "output": 10 },
    "claude-opus-5-5": { "input": 4, "output": 20 }
  },
  "includeGlobs": [],
  "excludeGlobs": []
}
```

- `models` maps the tier names (haiku, sonnet, opus) to model ids. Override them to pin a different model. By default discovery uses Haiku, security and external use Opus, the other domains use Sonnet, and synthesis uses Opus.
- `pricing` is USD per million tokens, keyed by model id, and drives the cost estimate. A model id with no entry falls back to the Sonnet rate, so add an entry if you point `models` at a different id.
- `ci.failOn` sets the severity thresholds that produce a non-zero exit code in `--ci` mode.
- `includeGlobs` and `excludeGlobs` narrow what the scanner reads.

If a preferred model is unavailable or rate-limited, the CLI falls back Opus to Sonnet to Haiku and records a warning in the report.

---

## CI/CD integration

### Recommended: headless plugin

If you can install Claude Code in the pipeline, run the plugin. Findings are verified, and the same plugin runs locally and in CI. `-p` is print mode (non-interactive); read the result from `report.json`. For permission handling in non-interactive runs (`--permission-mode`), see the Claude Code documentation.

```yaml
# .github/workflows/codebase-doctor-plugin.yml
name: Codebase Doctor (plugin)

on:
  workflow_dispatch:
  push:
    branches: [main]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Claude Code and Codebase Doctor
        run: |
          npm install -g @anthropic-ai/claude-code
          git clone https://github.com/nativardi/codebase-doctor.git /tmp/codebase-doctor

      - name: Run Codebase Doctor
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          claude -p --plugin-dir /tmp/codebase-doctor "/codebase-doctor analyze ."

      - name: Fail on critical findings
        run: |
          CRITICAL=$(jq '.severityCounts.critical' .optimization/report.json)
          if [ "$CRITICAL" -gt 0 ]; then
            echo "Critical issues found. See .optimization/report.md"
            exit 1
          fi

      - uses: actions/upload-artifact@v4
        with:
          name: codebase-doctor-report
          path: .optimization/
```

### Alternative: this CLI

Use the CLI where Claude Code cannot be installed. A ready-made workflow is at [`.github/workflows/codebase-doctor.yml`](../.github/workflows/codebase-doctor.yml). The essential steps:

```yaml
# .github/workflows/analyze.yml
name: Codebase Doctor Analysis (CLI)

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Codebase Doctor
        run: |
          git clone https://github.com/nativardi/codebase-doctor.git /tmp/codebase-doctor
          cd /tmp/codebase-doctor/cli-standalone
          npm install

      - name: Run Analysis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          node /tmp/codebase-doctor/cli-standalone/codebase-doctor.js analyze "$GITHUB_WORKSPACE" --ci > codebase-doctor-report.json

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: codebase-doctor-report
          path: |
            codebase-doctor-report.json
            .optimization/report.md
            .optimization/report.html
            .optimization/execution-plan.md
```

In `--ci` mode the CLI prints the canonical JSON to stdout and exits non-zero when the `ci.failOn` thresholds are met, so the step itself fails the build without a separate `jq` check. Remember that these findings are unverified, so consider gating on a trend or a threshold rather than failing on any single finding.

To enable either workflow: save it under `.github/workflows/`, add `ANTHROPIC_API_KEY` under Settings, Secrets and variables, Actions, and push.

Because each run makes model calls, running on `main`, on a schedule, or by manual trigger is usually a better fit than every pull request on a busy repository.

---

## What the CLI does

The CLI is not a prompt wrapper; it is an analysis engine.

1. **Scans your project.** Reads real files, respects `.gitignore`, skips binaries and files over 100KB, and logs skip reasons.
2. **Loads the lenses.** Domain prompts come from `skills/codebase-doctor/references/domains/`, and the finding contract is injected into every prompt.
3. **Runs domains in parallel.** Configurable concurrency (default 3) via `Promise.allSettled()`, with `max_tokens` of 16000 per call.
4. **Falls back gracefully.** If Opus is unavailable it tries Sonnet, then Haiku, with a warning in the report.
5. **Survives partial failures.** If 3 of 8 domains fail you still get a report for the other 5, with an explicit "5/8 domains analyzed" note.
6. **Synthesizes patterns only.** The synthesis call asks the model only for systemic patterns. Stable ids, dedupe, the health score, the execution plan, and top fixes are computed in code.
7. **Caches.** File hashes, config, and the model map decide whether re-analysis is needed. `--force` bypasses.
8. **Generates canonical output.** `report.json` is the source of truth; MD, HTML, and the execution plan derive from it.
9. **Tracks trends.** With a previous `report.json`, shows what is new, what is resolved, and the score delta.

What it does **not** do: verify findings, or implement fixes. For those use the plugin.

### Architecture

```
cli-standalone/
├── codebase-doctor.js              # Thin entrypoint
└── lib/
    ├── scanner.js       # Project walker + manifest builder
    ├── config.js        # Config loading with precedence; model + pricing defaults
    ├── cache.js         # Hash-based run caching
    ├── domains/index.js # Domain registry + file selectors (loads lens files)
    ├── orchestrator.js  # Parallel execution + model fallback
    └── reporter.js      # JSON -> MD/HTML/plan; ids, score, trend
```

### Tests

```bash
cd cli-standalone
npm test
```

20 tests using Node's built-in test runner: scanner, orchestrator, reporter, cache, config, CI mode, plugin layout, render adapter, HTML self-containment, and trend diff.

---

## Use cases

```bash
# Daily local use
codebase-doctor analyze /path/to/my/project

# Weekly re-check with cached discovery
codebase-doctor analyze /path/to/my/project --skip-discovery

# Multiple projects
for project in ~/projects/*; do
  codebase-doctor analyze "$project"
done

# Parallel projects
(codebase-doctor analyze /path/to/project-a &)
(codebase-doctor analyze /path/to/project-b &)
wait

# Performance troubleshooting
codebase-doctor analyze /path/to/project --skip-discovery
cat /path/to/project/.optimization/performance-findings.json
```

---

## FAQ

### Where do I get the API key?
https://console.anthropic.com/account/keys

### How much does it cost?
It depends on repository size and the model mix in your config. The CLI prints a cost estimate using the `pricing` table. Narrow the scope with `excludeGlobs`, or lower cost by pointing `models.opus` at a cheaper model.

### Is the API key secure?
The CLI uses it only to call Anthropic's API; it is read from the environment and never written to the output. Use an environment variable or your CI's secret store and rotate keys from the console at any time.

### Can I skip the API key?
Yes. Use the plugin in Claude Code instead; it runs on your Claude Code plan or API key. See the [main README](../README.md).

### How long does analysis take?
It depends on repository size, concurrency, and model load. Use `--concurrency` to adjust, and the cache makes unchanged re-runs fast.

### Will this modify my code?
No. The CLI is read-only. It creates only the `.optimization/` folder.

### Can I ignore certain files?
Yes. The scanner respects `.gitignore`, skips `.git`, `node_modules`, build and dist directories, and binaries, skips files over 100KB (configurable via `fileSizeLimitBytes`), and supports `includeGlobs` and `excludeGlobs`. Skip reasons are logged in the report.

### Why are the findings marked unverified?
The CLI has no verifier pass. Each finding is a model's claim from the files it was shown. The plugin adds an independent agent that tries to refute each one against the code. See [METHODOLOGY.md](../METHODOLOGY.md#why-verification).

---

## Troubleshooting

### "Command not found: codebase-doctor"

```bash
# Use the full path
~/codebase-doctor/cli-standalone/codebase-doctor.js analyze /path/to/project

# Or re-link / alias
cd ~/codebase-doctor/cli-standalone && npm link
alias codebase-doctor='~/codebase-doctor/cli-standalone/codebase-doctor.js'
```

### "API key not found"

```bash
echo $ANTHROPIC_API_KEY            # check
export ANTHROPIC_API_KEY="sk-ant-..."
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc && source ~/.zshrc
```

### "Project path does not exist"

Use an absolute path and confirm it exists:

```bash
ls /path/to/my-app
codebase-doctor analyze /path/to/my-app
```

### "No analysis found" (when running fix)

Run `codebase-doctor analyze` first.

### "Analysis seems incomplete"

Check the report for coverage notes (`cat .optimization/report.md`). A very large project is sampled, bounded by the prompt limits; the plugin explores with Read and Grep and handles size better. A clean project also produces few findings.

### "Node.js not found"

Install Node.js 18 or newer from https://nodejs.org/ and verify with `node --version`.

---

## Learn more

- [Main README](../README.md): the plugin, quick start
- [Plugin vs CLI](../VERSIONS.md)
- [Methodology](../METHODOLOGY.md)
- [Finding contract](../skills/codebase-doctor/references/finding-contract.md)
