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
