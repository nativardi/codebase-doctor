# Data Layer Lens

Hunt for defects in database access, schema design, and migrations. A finding is a concrete query, model, or migration with a real consequence, such as a loop issuing a query per row on a list endpoint, a multi-write that can half-apply, or a migration that locks a hot table. A missing optimization on a table with a documented small size is not a finding.

## Where to look first
- Data access code: repositories, `models/`, `dao/`, `queries/`, Prisma `schema.prisma` and client calls, Drizzle schemas, SQLAlchemy and Django ORM models, ActiveRecord models, `sqlc` or raw SQL files, Go `database/sql` usage.
- Schema and migrations: `migrations/`, `prisma/migrations`, `db/migrate`, `alembic/versions`, `supabase/migrations`, `*.sql`.
- Query call sites in handlers: `findMany`, `.filter(`, `.objects.all()`, `.where(`, `.includes(`, `select_related`, `prefetch_related`, `joinedload`.
- Grep patterns: `db.query(`, `.raw(`, `$queryRaw`, `SELECT \*`, `findMany(` without `take`, `.all()` without a slice, `for ... await` containing a query, `IN (` built from arrays, `deleted_at`, `BEGIN`, `$transaction`, `transaction.atomic`, `ADD COLUMN`, `CREATE INDEX` without `CONCURRENTLY`, `DROP COLUMN`.
- Client-side database access: `createClient(` from a BaaS SDK in browser code, direct connection strings in frontend bundles.

## How to trace
- Start from the endpoint or job and list every query it triggers, including those inside helper functions, serializers, and ORM lazy-loaded relations. Count queries per request against the size of the result set.
- Follow filter and join columns from the query to the schema or latest migration to see whether an index, constraint, or foreign key exists. Check the full migration history, not only the initial schema.
- For writes, find every statement that must succeed together and verify they share one transaction; follow the error path to see whether a partial write is left behind.
- For migrations, identify the table, its likely size, and whether the operation takes a long lock or breaks the application version still running during deploy.
- Grep for callers rather than assuming a query is rarely hit; a helper called from a list endpoint multiplies its cost.

## Checks
- **N+1 queries**: Flag queries or relation loads issued inside loops, `map` callbacks, serializers, or GraphQL resolvers where a join, `include`, or batch load applies.
- **Unbounded queries**: Flag list reads with no `LIMIT`, `take`, or pagination on tables that grow with usage.
- **Missing indexes**: Flag filter, sort, join, and foreign key columns with no supporting index.
- **Composite indexes**: Flag multi-column `WHERE` plus `ORDER BY` patterns served only by single-column indexes, and tenant-scoped queries lacking a leading tenant column.
- **Schema integrity**: Flag missing `NOT NULL`, `UNIQUE`, foreign keys, check constraints, and money stored as floats or timestamps without time zone.
- **Missing transactions**: Flag multi-write operations (create order plus decrement stock, transfer between balances) executed as separate statements with no transaction.
- **Read-modify-write races**: Flag check-then-update sequences with no row lock, atomic update, or unique constraint.
- **Soft-delete leaks**: Flag queries, joins, and counts on tables with `deleted_at` that omit the filter, and unique constraints that ignore deleted rows.
- **Unbounded IN lists**: Flag `IN` or `ANY` clauses built from unbounded arrays, which hit parameter limits and plan degradation.
- **Migration safety**: Flag `CREATE INDEX` without `CONCURRENTLY`, adding a `NOT NULL` column with a volatile default on a large table, destructive `DROP` in the same release as the code change, and non-reproducible or unversioned migrations.
- **Client-side database access**: Flag browser code that talks to the database directly without verified row-level policies.

## Category slugs
- `n-plus-one`
- `unbounded-query`
- `missing-pagination`
- `missing-index`
- `missing-composite-index`
- `missing-constraint`
- `wrong-column-type`
- `missing-transaction`
- `read-modify-write-race`
- `soft-delete-leak`
- `unbounded-in-list`
- `unsafe-migration`
- `destructive-migration`
- `client-side-db-access`

## Severity anchors
- **critical**: Destructive or irreversible migration on a normal deploy path, writes that corrupt data under normal concurrency, or a table readable and writable by any client.
- **high**: N+1 on a hot list endpoint, multi-write with no transaction on money or inventory, soft-deleted data returned to users, missing unique constraint behind a duplicate-prone flow.
- **medium**: Unbounded list reads, missing foreign key indexes, locking `CREATE INDEX` on a growing table, unbounded `IN` lists, floats used for currency.
- **low**: Missing `NOT NULL` on rarely written columns, naming inconsistencies, unused indexes, absent migration down steps in dev-only schemas.

## Not a finding here
- `SELECT *` or an unpaginated read on a small config, enum, or lookup table with a bounded row count.
- A query that interpolates a table name from a constant allowlist while keeping values parameterized.
- A loop issuing queries in a one-off script, seed, or backfill that runs once and offline.
- A missing index on a table with a documented row cap, or where the ORM or migration creates it implicitly (primary key, unique constraint, Rails `references`).
- Multiple statements without a transaction where each is independently idempotent and a retry reconciles them.
- Eager loading handled by the ORM through `include`, `select_related`, or a dataloader; confirm it before reporting an N+1.
