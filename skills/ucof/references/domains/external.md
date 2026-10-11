# External Services Lens

Hunt for fragile integrations with third-party APIs, webhooks, queues, background workers, and LLM providers. A finding is a concrete call site or handler with a real failure consequence, such as a payment webhook that double-charges on redelivery or an LLM call whose output reaches a database write unvalidated. An integration that merely lacks a preferred library or pattern is not a finding.

## Where to look first
- SDK and client wrappers: `lib/stripe.*`, `services/`, `clients/`, `integrations/`, files importing `openai`, `@anthropic-ai/sdk`, `stripe`, `twilio`, `sendgrid`, `aws-sdk`, `@slack/web-api`, `axios`, `requests`, `httpx`, `net/http`.
- Webhook receivers: `/webhooks/*`, `/api/stripe`, Next.js route handlers reading `req.text()` or raw bodies, Django/Rails endpoints with CSRF exemptions.
- Queues and workers: BullMQ/Bee-Queue/Sidekiq/Celery/RQ/Temporal workers, `cron` handlers, Lambda or edge functions, `worker.js`, `tasks.py`, retry and `attempts` config.
- Config keys: `timeout`, `retries`, `maxRetries`, `backoff`, `concurrency`, `removeOnFail`, `deadLetter`, `idempotencyKey`, `signingSecret`.
- Grep patterns: `fetch(` without `AbortSignal`, `axios.` without `timeout`, `requests.get(` without `timeout=`, `http.Client{}` without `Timeout`, `stripe.webhooks.constructEvent`, `completions.create(`, `messages.create(`, `JSON.parse(` near an LLM response, `catch {}` around API calls, `setTimeout(` retry loops, `Promise.all(` over API calls.

## How to trace
- Start at the call site of each outbound request and follow what happens on timeout, 4xx, 429, 5xx, and a malformed body. Locate the wrapper or interceptor that may already add retries or timeouts before reporting their absence.
- For webhooks, trace from the route to the first side effect. Verify that signature checking uses the raw body and runs before parsing or any database write.
- For jobs, follow enqueue to handler to completion: what persists the job, what happens on throw, how many attempts occur, and whether the handler is safe to run twice.
- For LLM calls, follow the response from the SDK return to its consumer: parsing, schema validation, and any tool or code execution it can trigger. Grep for callers of the wrapper rather than assuming a shared validation layer exists.
- Cross files: a client wrapper in `lib/` often sets defaults that every call site inherits; read it before judging callers.

## Checks
- **Retry logic**: Flag calls to flaky or rate-limited APIs with no retry, or with immediate retries lacking exponential backoff and jitter.
- **Timeouts**: Flag outbound requests with no timeout or abort signal; the default in many clients is unbounded.
- **Rate limits**: Flag code that ignores 429 or `Retry-After`, or fans out requests with no concurrency cap.
- **Job reliability**: Flag in-memory queues, `setTimeout` or fire-and-forget promises standing in for jobs, and workers that lose work on crash.
- **Dead letter handling**: Flag failed jobs that are deleted (`removeOnFail: true`) or retried forever with no inspection path.
- **Webhook verification**: Flag receivers that skip signature verification, compare signatures without constant-time equality, or verify against a parsed rather than raw body.
- **Webhook replay and idempotency**: Flag handlers with no event-id dedupe or timestamp tolerance, and payment or email actions repeated on redelivery.
- **Idempotency keys**: Flag outbound payment, order, or message creation that retries without an idempotency key.
- **LLM output validation**: Flag model output parsed with bare `JSON.parse` and used without schema validation (zod, pydantic) or a repair and fallback path.
- **Tool-call allowlists**: Flag agent loops where the model chooses tool names or arguments (shell, SQL, file paths, URLs) that are not checked against an allowlist.
- **Circuit breakers and fallbacks**: Flag hot request paths that hard-fail whenever one third-party dependency is down, with no degraded mode.
- **Streaming timeouts**: Flag streamed LLM or SSE responses with no idle timeout, no cancellation on client disconnect, and no cap on output tokens.

## Category slugs
- `no-retry`
- `no-timeout`
- `ignored-rate-limit`
- `unverified-webhook`
- `webhook-replay`
- `missing-idempotency-key`
- `non-durable-job`
- `no-dead-letter-queue`
- `unbounded-job-retries`
- `unvalidated-llm-output`
- `unrestricted-tool-calls`
- `no-circuit-breaker`
- `streaming-no-timeout`
- `swallowed-api-error`

## Severity anchors
- **critical**: Unverified webhook that grants access or moves money, or LLM output executed as code, SQL, or shell without validation.
- **high**: Payment or order creation retried without idempotency, webhook handler that double-applies on redelivery, jobs lost on worker crash, no timeout on a request-path dependency.
- **medium**: No backoff on retries, ignored 429, no dead-letter path, unvalidated LLM JSON feeding non-critical features, no circuit breaker around an optional dependency.
- **low**: Missing jitter, inconsistent client configuration across call sites, unused retry options, absent request logging for third-party calls.

## Not a finding here
- A missing retry on a non-idempotent call that deliberately fails fast and surfaces the error to the user.
- No timeout set on a client whose wrapper or HTTP agent already applies a global default; locate the config before reporting.
- Webhook handlers behind a gateway or SDK middleware that verifies signatures (check for `constructEvent`, `verifyKey`, or a framework plugin).
- Single-attempt calls in one-off scripts, migrations, or local developer tooling.
- LLM output rendered as plain text, shown to the same user who supplied the prompt, with no downstream action.
- Duplicate-event handling that is naturally idempotent, such as an upsert keyed by the provider's event or object id.
