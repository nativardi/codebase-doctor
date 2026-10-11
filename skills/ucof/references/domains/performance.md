# Performance Lens

Hunt for bottlenecks and resource waste that hurt latency, throughput, or memory on real paths. A finding is a concrete line on a hot or scaling path with a measurable consequence, such as an API call per list item, synchronous hashing inside a request handler, or an uncleaned subscription that leaks per navigation. Micro-optimizations on cold paths are not findings.

## Where to look first
- Request paths: route handlers, GraphQL resolvers, server components, middleware, serializers, and anything invoked per request or per list item.
- Loops over collections: `map`, `forEach`, `for ... of` with `await`, `Promise.all` over large arrays, ORM relation access inside serializers.
- Clients and polling: `setInterval(`, `setTimeout` loops, `refetchInterval`, `useEffect` with timers, SSE and WebSocket setup, `addEventListener(` and `subscribe(` sites.
- Caching layers: Redis/memcached clients, `cache()` and `unstable_cache`, `revalidate`, `Cache-Control` headers, SWR and TanStack Query config, memoization helpers.
- Heavy work: image handling, PDF and CSV generation, crypto, compression, parsers, report builders, file reads.
- Grep patterns: `readFileSync(`, `writeFileSync(`, `execSync(`, `pbkdf2Sync(`, `bcrypt.hashSync(`, `crypto.scryptSync(`, `JSON.parse(` on request or file bodies, `Promise.all(` with `.map(`, `await` inside `for`, `setInterval(`, `.filter(` chained inside `.map(`, `SELECT \*`, `fetch(` inside loops, `<img` without `loading`, `new RegExp(` in loops.

## How to trace
- Start from an entry point that runs often (list page, feed, webhook, cron) and estimate the work per call as a function of input size. Follow into helpers to count queries, API calls, and allocations.
- Locate the blocking boundary: on single-threaded runtimes (Node, Python asyncio), find synchronous CPU or I/O work reachable from the event loop.
- For caching, find the key, the TTL, the invalidation path, and what happens when the entry expires under concurrent load.
- For leaks, pair every `addEventListener`, `subscribe`, `setInterval`, and open handle with its teardown in the same lifecycle (effect cleanup, `close`, `finally`).
- Grep for callers rather than assuming a slow function is rarely used; a helper used by a list endpoint is multiplied by page size.

## Checks
- **Polling intervals**: Flag intervals under about 3 seconds against remote APIs where push, SSE, or backoff applies, and polling that continues while the tab is hidden.
- **Caching strategy**: Flag identical expensive computations or reads repeated per request with no cache, and caches with no TTL or invalidation.
- **Cache stampede**: Flag hot keys that expire together and trigger many concurrent recomputes with no lock, request coalescing, or stale-while-revalidate.
- **N+1 across API calls**: Flag per-item HTTP or RPC calls inside loops or resolvers where a batch endpoint exists.
- **Synchronous work in the request path**: Flag `*Sync` fs, crypto, compression, and large regex or sorting work on the event loop.
- **Large payloads and parsing**: Flag `JSON.parse` of large or unbounded bodies, full-file reads into memory, and endpoints returning far more fields than the view needs.
- **Unbounded concurrency**: Flag `Promise.all` over thousands of items, unbounded worker spawning, and fan-out with no limiter such as `p-limit`.
- **Missing streaming**: Flag large downloads, exports, and LLM responses buffered fully before sending.
- **Memory management**: Flag listeners, timers, subscriptions, and caches (unbounded `Map` or module-level arrays) that grow without cleanup or eviction.
- **Asset optimization**: Flag unoptimized or eager-loaded large images and fonts, and missing compression or caching headers on static assets.
- **Repeated computation**: Flag expensive derivations recomputed every render or loop iteration where memoization or hoisting applies.

## Category slugs
- `aggressive-polling`
- `missing-cache`
- `cache-stampede`
- `n-plus-one-api-calls`
- `sync-io-in-request-path`
- `sync-crypto-in-request-path`
- `large-payload`
- `unbounded-json-parse`
- `unbounded-concurrency`
- `missing-streaming`
- `memory-leak`
- `unbounded-cache-growth`
- `unoptimized-assets`
- `repeated-computation`

## Severity anchors
- **critical**: Event-loop-blocking or unbounded-memory path reachable by any caller that stalls or crashes the service under normal load.
- **high**: N+1 or per-item API fan-out on a hot list, unbounded `Promise.all` that exhausts connections, synchronous password hashing in a login handler, leak that grows per request.
- **medium**: Sub-3-second polling, no caching on expensive repeated reads, buffered large exports, oversized payloads, stampede-prone hot keys.
- **low**: Missed memoization on cheap work, unoptimized small images, redundant array passes on small collections.

## Not a finding here
- Synchronous fs or crypto calls at process startup, in CLIs, build scripts, and one-off migrations where blocking is harmless.
- Polling in a dev-only script, an admin tool with a handful of users, or against a local resource.
- `Promise.all` over a collection with a documented or enforced small cap (a fixed list of 5 services, a page-size-limited array).
- Missing cache where data must be fresh by requirement, or where the underlying call is already cheap and cached downstream.
- Quadratic loops over inputs bounded to tens of items.
- `JSON.parse` of small config files or of bodies already limited by a body size limit; check the parser limit before reporting.
