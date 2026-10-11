# Security Lens

Hunt for exploitable weaknesses: missing authentication or authorization, injection, secret exposure, unsafe handling of untrusted input, and abuse paths such as SSRF or prompt injection. A finding is a concrete defect at a concrete line with a real consequence, such as a route that reads another tenant's rows or a string-built query reachable from a request. A missing best practice with no reachable path from untrusted input is not a finding.

## Where to look first
- Route and handler entry points: Express/Fastify/Koa routers, Next.js `app/**/route.ts` and `pages/api/**`, Django `views.py` and `urls.py`, Rails `controllers/`, Flask/FastAPI routes, Go `http.HandleFunc` and gin/chi handlers, Spring controllers.
- Auth plumbing: middleware, decorators, guards (`@login_required`, `before_action`, `requireAuth`, `getServerSession`), JWT and session helpers, password reset and OAuth callback code.
- Data models and policies: Prisma/Drizzle/SQLAlchemy/ActiveRecord models, Postgres RLS policies in migrations (Supabase `create policy`, `enable row level security`).
- Config and secrets: `.env*` committed files, `config/*.{js,py,yml}`, `docker-compose.yml`, CI workflows, `settings.py` (`SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`), CORS setup.
- Grep patterns: `db.query(`, `.raw(`, `$queryRawUnsafe`, `execute(f"`, `execSync(`, `child_process`, `os.system(`, `subprocess` with `shell=True`, `eval(`, `new Function(`, `dangerouslySetInnerHTML`, `innerHTML`, `pickle.loads`, `yaml.load(`, `readFile(` with request data, `jwt.verify(`, `jwt.decode(`, `algorithms`, `cors(`, `origin: '*'`, `fetch(` or `axios.get(` with a request-derived URL, `AKIA`, `sk_live_`, `BEGIN PRIVATE KEY`, `Object.assign(` or `...req.body` into a model.

## How to trace
- Start at the source: request params, query, body, headers, cookies, uploaded filenames, webhook payloads, and any text from an LLM or third-party API. Follow each value across files and wrappers to the sink.
- Name the sink: SQL or ORM raw call, shell, filesystem path, outbound HTTP, template or HTML output, deserializer, redirect target, LLM prompt, or model mass-assignment.
- Identify the guard on the path: parameterization, schema validation, allowlist, ownership check (`where userId = session.user.id`), escaping, URL host allowlist. A guard counts only when it runs before the sink on every path.
- For authorization, locate where the resource is loaded and verify the check compares the owner or tenant to the authenticated principal, not merely that a session exists.
- Grep for callers rather than assuming. Before reporting a missing check, search for middleware registration, router-level guards, and framework defaults that may already apply to the route.

## Checks
- **Authentication**: Flag endpoints that read or mutate data with no session or token check, including internal-looking `/admin`, `/debug`, and `/api/internal` routes.
- **Authorization and IDOR**: Flag handlers that fetch by a client-supplied id without scoping to the caller or tenant; flag role checks done only in the UI.
- **Secrets**: Flag hardcoded keys, passwords, tokens, and connection strings in source, fixtures that hold real values, and passwords stored unhashed or with fast hashes (md5, sha1, plain sha256) instead of argon2, bcrypt, or scrypt.
- **Injection**: Flag SQL built by concatenation or interpolation, shell commands built from input, XSS sinks fed unescaped data, and NoSQL operator injection from unvalidated JSON bodies.
- **Rate limiting**: Flag login, password reset, OTP, and signup endpoints with no throttling.
- **CORS and cookies**: Flag `Access-Control-Allow-Origin: *` with credentials, reflected origins, and session cookies lacking `HttpOnly`, `Secure`, or `SameSite`.
- **Row Level Security**: Flag tables exposed through a client SDK (Supabase, Firebase) with RLS disabled or policies of `using (true)`.
- **SSRF**: Flag server-side fetches of user-supplied URLs with no scheme, host, or private-IP allowlist (link previews, webhooks, image proxies, importers).
- **Prompt injection**: Flag untrusted text concatenated into LLM prompts where the model can call tools, run code, or return content rendered as HTML or executed.
- **Mass assignment**: Flag `Model.create(req.body)`, `update(...req.body)`, or permit-all params that let callers set `role`, `isAdmin`, or `tenantId`.
- **JWT handling**: Flag `alg: none` acceptance, `jwt.decode` used where `verify` is needed, missing audience or expiry checks, and weak or default signing secrets.
- **Path traversal and unsafe deserialization**: Flag file reads or writes using unnormalized request paths or upload names, and `pickle`, `yaml.load`, or Java/PHP native deserialization on untrusted data.
- **CSRF**: Flag state-changing routes that authenticate by cookie with no CSRF token or `SameSite` protection.

## Category slugs
- `missing-auth`
- `idor`
- `broken-access-control`
- `sql-injection`
- `command-injection`
- `xss`
- `hardcoded-secret`
- `weak-password-storage`
- `missing-rls`
- `ssrf`
- `path-traversal`
- `insecure-deserialization`
- `mass-assignment`
- `jwt-misconfiguration`
- `missing-csrf`
- `permissive-cors`
- `missing-rate-limit`
- `prompt-injection`

## Severity anchors
- **critical**: Unauthenticated injection, auth bypass, RCE, a live secret in the repo, or a public table or bucket exposing other users' data.
- **high**: IDOR or privilege escalation behind login, SSRF to internal addresses, mass assignment of role fields, JWT signature not verified, missing CSRF on a money or account action.
- **medium**: No rate limit on login or reset, permissive CORS without credentials, weak hashing on low-value data, missing cookie flags, injection reachable only by an admin.
- **low**: Verbose auth error messages, missing security headers, defense-in-depth gaps with no reachable exploit path.

## Not a finding here
- A query that interpolates a table or column name chosen from a constant allowlist while values stay parameterized.
- A secret-looking string that is a documented placeholder (`changeme`, `your-key-here`), a public publishable key (Stripe `pk_`, Supabase anon key), or a value read from the environment.
- An endpoint without auth checks that sits behind router-level or gateway middleware; confirm by locating the registration before reporting.
- `eval`, `exec`, or `dangerouslySetInnerHTML` fed only by constants or by content sanitized with a located sanitizer (DOMPurify, framework auto-escaping).
- Missing rate limiting on endpoints that are cheap, public, and read-only, or that sit behind a documented upstream limiter.
- Test fixtures, seed scripts, and local-only `docker-compose` credentials, unless a production flow reaches them.
