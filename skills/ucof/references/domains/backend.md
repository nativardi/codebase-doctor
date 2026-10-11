# Backend Lens

Hunt for defects in server-side request handling, API design, error handling, and process lifecycle. A finding is a concrete handler, middleware, or server setup with a real consequence, such as a write endpoint that trusts an unvalidated body or an error handler that returns stack traces to clients. Inconsistency alone, with no client-visible breakage or operational risk, is low severity at most.

## Where to look first
- Route definitions and handlers: Express/Fastify/Koa/Hono routers, NestJS controllers, Next.js `app/**/route.ts` and `pages/api/**`, Django `views.py` and DRF serializers, Flask/FastAPI routers, Rails `controllers/`, Go handlers and chi/gin routers, Spring controllers.
- Middleware and bootstrap: `server.{js,ts}`, `app.{js,ts}`, `main.py`, `wsgi.py`, `config/application.rb`, `main.go`, error-handling middleware, body parser setup.
- Validation and schema layers: zod, Joi, yup, valibot, pydantic models, DRF serializers, Rails strong parameters, JSON schema files, OpenAPI specs.
- Config keys: body size limits (`limit:`, `bodyParser`, `client_max_body_size`, `DATA_UPLOAD_MAX_MEMORY_SIZE`), `timeout`, `keepAliveTimeout`, session and cookie options.
- Grep patterns: `req.body` used without a parse step, `res.status(500).json(err`, `err.stack`, `catch (e) {}`, `process.on('uncaughtException'`, `app.listen(`, `SIGTERM`, `res.send(error`, `JSON.parse(` on input, `multer(` without limits, `express.json()` without `limit`, `.then(` without `.catch(`, `async` handlers in Express 4 without a wrapper.

## How to trace
- Start at the route registration and follow the request through middleware order to the handler, then to services and storage. Note where the body, query, and params are first parsed and whether a schema runs before use.
- Trace every `throw` and rejected promise to the nearest error handler and check what it returns and logs. Express 4 does not catch rejected async handlers without a wrapper; verify the framework version before reporting.
- Follow write paths to the database or external call and confirm validation happened on every route, not only the one that was obvious. Grep for sibling routes sharing a resource.
- Check lifecycle code across files: server start, signal handlers, connection pool teardown, and in-flight request draining.
- Grep for callers rather than assuming a shared validation or error middleware covers a route; confirm it is mounted before the route.

## Checks
- **Input validation**: Flag routes that use `req.body`, query, or params without schema validation, especially on write paths, and validation that checks types but not ranges, lengths, or enums.
- **Boundary schemas**: Flag handlers that cast to a TypeScript type instead of parsing with zod or pydantic, so types lie about runtime data.
- **Error handling**: Flag empty catch blocks, swallowed rejections, and responses that leak stack traces, SQL text, or file paths.
- **Error envelope**: Flag APIs that return mixed shapes (`{error}`, `{message}`, plain strings, HTML) and wrong status codes (200 with an error body, 500 for client mistakes).
- **Timeouts**: Flag long-running handlers and outbound calls with no deadline, and servers with default or disabled request timeouts.
- **Request size limits**: Flag missing body or upload limits, unbounded multipart parsing, and file uploads with no type or size check.
- **Authentication architecture**: Flag session or JWT handling with no expiry, no revocation path, tokens in `localStorage` for sensitive apps, and refresh logic with no rotation.
- **Pagination and filtering contracts**: Flag list endpoints that accept unbounded `limit`, or sort and filter fields passed straight to the query.
- **Graceful shutdown**: Flag servers with no `SIGTERM` handler, no draining of in-flight requests, and no closing of pools and queues, which drops requests on every deploy.
- **Idempotent writes**: Flag POST endpoints for payments or orders that a client retry can duplicate.
- **Process-level safety nets**: Flag `uncaughtException` handlers that log and continue in a corrupted state.

## Category slugs
- `missing-input-validation`
- `unvalidated-type-cast`
- `swallowed-error`
- `error-detail-leak`
- `inconsistent-error-envelope`
- `wrong-status-code`
- `no-request-timeout`
- `no-body-size-limit`
- `unrestricted-file-upload`
- `weak-session-management`
- `unbounded-page-size`
- `no-graceful-shutdown`
- `non-idempotent-write`
- `unhandled-async-rejection`

## Severity anchors
- **critical**: Write endpoint on a sensitive resource with no validation that lets callers corrupt or escalate, or a crash-on-input path that takes the whole process down.
- **high**: Missing validation on a normal write path, stack traces or secrets in client responses, unbounded uploads on a public endpoint, duplicated payments on retry.
- **medium**: No graceful shutdown, no request timeouts, swallowed errors that hide failures, unbounded page size, tokens without expiry.
- **low**: Inconsistent status codes or error shapes, naming drift across routes, missing request ids in logs.

## Not a finding here
- Missing validation on an internal route that only receives already-validated input from a typed caller in the same service, when that caller is verifiable.
- Stack traces returned in a development-only branch gated by `NODE_ENV` or `DEBUG` that production config disables.
- No explicit body limit where the framework default (Express 100kb, Fastify 1MB, Django 2.5MB) is acceptable for the route.
- Unhandled-rejection concerns on frameworks that wrap async handlers (Fastify, Express 5, NestJS, Koa); confirm the version.
- Missing graceful shutdown on serverless functions or short-lived scripts where the platform owns the lifecycle.
- Different status codes between a public API and an internal admin tool that are documented and consistent within each.
