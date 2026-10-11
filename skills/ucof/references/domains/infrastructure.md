# Infrastructure Lens

Hunt for defects in build, deployment, CI/CD, container, and environment configuration. A finding is a concrete workflow step, Dockerfile line, or config key with a real consequence, such as a deploy that ships untested code, a secret printed to CI logs, or a container running as root with no limits. Absent tooling that the project has no need for is not a finding.

## Where to look first
- CI/CD: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`, `Jenkinsfile`, `azure-pipelines.yml`, deploy scripts, `Makefile`.
- Containers and orchestration: `Dockerfile*`, `.dockerignore`, `docker-compose*.yml`, Kubernetes manifests, Helm charts, `fly.toml`, `render.yaml`, `vercel.json`, `netlify.toml`, `Procfile`, `serverless.yml`.
- Infrastructure as code: Terraform `*.tf`, Pulumi, CloudFormation, CDK files; state and variable files.
- Environment and secrets: `.env*`, `.env.example`, config loaders, secret references in workflows, `.gitignore`.
- Observability: Sentry/Datadog/OpenTelemetry init, logger setup, health route handlers (`/health`, `/healthz`, `/ready`).
- Grep patterns: `uses: .*@(main|master|v\d)$`, `echo \$\{\{ secrets`, `set -x`, `USER root`, `FROM .*:latest`, `ADD http`, `curl .* | sh`, `privileged: true`, `0.0.0.0/0`, `ports:` exposing databases, `HEALTHCHECK`, `livenessProbe`, `resources:`, `npm install` in CI instead of `npm ci`, `--no-verify`, `continue-on-error: true`.

## How to trace
- Start at the deploy trigger (push to main, tag, manual dispatch) and follow the workflow to what gets shipped. Check which jobs gate it with `needs:` and whether tests and lint truly block the deploy.
- Trace each secret from definition to every use: step `env:`, `run:` scripts, build args, image layers, and logs. A secret passed through `ARG` or echoed in a script can persist in layers or output.
- Read the Dockerfile top to bottom: base image tag, user, copied files, exposed ports, and what ends up in the final stage.
- Follow environment variable names across `.env.example`, compose files, workflows, and the code that reads them to find mismatches between environments.
- Grep for the config rather than assuming a default: a probe, limit, or pinned version may live in a Helm values file or an overlay rather than the base manifest.

## Checks
- **CI/CD pipeline**: Flag deploys with no automated tests, lint, or type-check gate, and `continue-on-error` on those gates.
- **Secrets in CI logs**: Flag `echo` of secrets, `set -x` around secret use, and secrets passed on command lines or via build args that land in image layers.
- **Pinned action versions**: Flag third-party GitHub Actions referenced by branch or mutable tag rather than a commit SHA, and `pull_request_target` workflows that check out untrusted code.
- **Workflow permissions**: Flag workflows missing a restrictive `permissions:` block on tokens that can write.
- **Dockerfile hygiene**: Flag containers running as root, `latest` base tags, secrets copied into images, missing `.dockerignore`, and `curl | sh` installs.
- **Health and readiness probes**: Flag services with no health endpoint, or orchestrator manifests lacking liveness and readiness probes.
- **Resource limits**: Flag containers and pods with no CPU or memory requests and limits.
- **Secrets management**: Flag committed `.env` files, credentials in IaC, and shared secrets across environments.
- **Environment separation**: Flag staging and production sharing databases, keys, or buckets.
- **Dependency audit**: Flag no lockfile, no automated dependency scanning (npm audit, Dependabot, pip-audit), and unpinned production dependencies.
- **Error monitoring and logging**: Flag production services with no error reporting or structured logs reaching a central place.
- **Network exposure**: Flag databases, caches, and admin ports published to `0.0.0.0` or wide-open security groups.

## Category slugs
- `no-ci-gate`
- `secret-in-ci-log`
- `unpinned-action`
- `excessive-workflow-permissions`
- `container-runs-as-root`
- `unpinned-base-image`
- `secret-in-image`
- `missing-health-probe`
- `missing-resource-limits`
- `committed-env-file`
- `shared-environments`
- `no-dependency-audit`
- `missing-error-monitoring`
- `exposed-service-port`

## Severity anchors
- **critical**: Live credentials committed or printed to logs, a production database exposed to the public internet, or untrusted code executed with write tokens in CI.
- **high**: Deploy path with no test gate, containers running as root with a writable host mount, production and staging sharing data stores, unpinned third-party action with secrets access.
- **medium**: No health or readiness probes, no resource limits, `latest` base images, no dependency scanning, no error monitoring.
- **low**: Missing `.dockerignore`, verbose build logs, unused workflow files, inconsistent env var names between environments.

## Not a finding here
- Tags such as `actions/checkout@v4` from first-party GitHub organizations on a repository with low sensitivity; reserve findings for third-party actions with secret access.
- `USER root` in an early build stage of a multi-stage Dockerfile when the final stage drops privileges.
- Absent resource limits in a local `docker-compose.yml` used only for development.
- A `.env` file listed in `.gitignore` and absent from history, or an `.env.example` holding placeholders.
- Missing monitoring or probes on batch jobs, CLIs, and libraries that have no long-running serving process.
- Platform-managed concerns (Vercel, Netlify, Cloud Run health, TLS, autoscaling) already handled by the host; check the platform config before reporting.
