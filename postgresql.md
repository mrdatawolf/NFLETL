# Migrating bronze off PGlite to real PostgreSQL

## Why

On 2026-08-17, `bronze.db` (the PGlite data directory shared by NFLETL and
NFLDataAPI) started hard-aborting on open (`RuntimeError: Aborted()` inside
`_pg_initdb`, both from the app and from a bare `new PGlite(path)` repro with
no app code involved). Root cause: the data directory itself was corrupted —
not a permissions, disk-space, memory, or concurrent-access issue at the time
of the incident. PGlite is a single-process, embedded WASM build of Postgres;
it doesn't have the crash-safety engineering (WAL, fsync discipline,
checkpointing) that a real Postgres server has, and NFLETL's README already
flagged multi-process access to a shared PGlite directory as an [untested
risk](./README.md#known-risk-concurrent-access-to-bronzedb). Moving to a real
Postgres server fixes both: normal Postgres crash recovery, and native
support for multiple concurrent client connections instead of two processes
opening the same embedded engine's files.

The existing `bronze.db` is not being migrated — it's rebuilt from scratch by
re-running ingestion against the original sources (raptor, sawfilers, porter,
tally). Bronze is a raw landing layer, not a golden copy, so this is the
simpler and safer path over trying to salvage a corrupted data directory.

## Target architecture

One Postgres server/instance, two databases:

| Database | Owner | Access |
| --- | --- | --- |
| `bronze` | NFLETL (this repo) | `nfletl` role: full read/write. `nfldataapi` role: `SELECT` only. |
| `silver` | NFLDataAPI (sibling repo, phase 2) | `nfldataapi` role: full read/write. Not created by this repo. |

Separate databases rather than one database with schema-scoped grants —
simpler to reason about (a normal Postgres user/database pair per service,
default privileges, nothing to misconfigure into an accidental bronze write)
and matches "two services, two datastores." The cost — no native
cross-database `JOIN` between bronze and silver — doesn't matter here since
silver tables are built by parsing bronze's raw JSONB payloads in application
code, not by SQL joins.

## Phase 1 — NFLETL (this repo)

### Host/ops prerequisites (not app-managed)

NFLETL should **check** connectivity and schema, not attempt to install or
provision the server itself — installing system packages from app startup
needs root and isn't portable. One-time setup on the host:

1. Install and start a Postgres server.
2. Create the `bronze` database.
3. Create the `nfletl` role (owns/writes `bronze`) and the `nfldataapi` role
   (`GRANT CONNECT ON DATABASE bronze TO nfldataapi;` +
   `GRANT SELECT ON ALL TABLES IN SCHEMA bronze TO nfldataapi;` + an
   `ALTER DEFAULT PRIVILEGES ... GRANT SELECT` so newly-created landing
   tables inherit read access automatically, since landing tables are
   created dynamically per source table).
4. Create the `silver` database and `nfldataapi` role's ownership of it —
   this step belongs to NFLDataAPI's own migration (phase 2), not this repo.

### App changes (`src/db.ts`, `src/config.ts`)

- Swap the `@electric-sql/pglite` dependency for `pg` (node-postgres).
  `db.query()`/`db.exec()` call shapes stay close to identical (`pg`'s
  `pool.query(text, params)` also returns `{ rows }`), so `ingest.ts` and the
  `sources/` connectors shouldn't need changes beyond the import.
- Replace `DB_PATH` with standard libpq-style connection env vars
  (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`) — `pg.Pool()`
  reads these automatically with no config object needed, and it keeps
  `psql`-based debugging using the same env vars.
- Add a preflight connectivity check on startup: attempt a trivial query,
  fail fast with a clear error (which server/db/user it tried) rather than
  the opaque WASM-style abort we hit this time.
- Keep the existing bootstrap DDL in `initDb()`/`ensureLandingTable()`
  unchanged — it's already idempotent (`CREATE SCHEMA IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`) and already targets Postgres syntax, so it
  should run as-is against a real server.
- Ingestion/upsert logic (`ingest.ts`, `sources/*`) is unaffected — it only
  depends on `db.query`/`db.exec`, not on PGlite specifically.

### Data

- Do not attempt to migrate the corrupted PGlite directory.
- After the new `bronze` database is up and the app connects to it, run a
  full scan of all four sources (raptor, sawfilers, porter, tally) to
  rebuild bronze from scratch, same as a fresh clone would today.

### Cleanup once this phase is done

- Update the README's "Known risk: concurrent access to bronze.db" section —
  that risk goes away once NFLDataAPI also moves off the shared PGlite
  directory (phase 2).

## Phase 2 — NFLDataAPI (sibling repo, separate plan)

Out of scope for this document. Summary of what changes there, to be
detailed in NFLDataAPI's own plan doc next:

- Swap its own `@electric-sql/pglite` read path for a `pg` client connected
  to the `bronze` database as the `nfldataapi` role (read-only — enforced by
  the grant, not just by convention/comment as today).
- Provision and own a new `silver` database on the same server, with full
  read/write access, for whatever derived/transformed tables it builds from
  bronze's raw JSONB payloads.
