# NFLETL

Standalone ETL for NFLDataAPI's bronze layer. Owns everything that writes to
the PostgreSQL bronze database: parsing NBE Edger Optimizer Tally reports into
their own SQLite db, and scanning all configured sources (Raptor, Saw Filers,
Porter, and the tally output) into bronze. NFLDataAPI is a read-only consumer
of that database — it no longer ingests anything itself.

This mirrors the split already used by [SFP_Tally_ETL](../SFP_Tally_ETL) /
SFPDataAPI: a plain CLI tool invoked by cron (or manually), not a long-running
server. No MW/shipping pipeline here — not used at this location.

## Structure

| Piece | Responsibility |
| --- | --- |
| `src/tally/parser.ts` | Pure parsing — turns a raw tally `.txt` report into typed records. Raises on structural failure. Ported from SFP_Tally_ETL's `tally_parser.py`; same report format across mills. |
| `src/tally/etl.ts` | Orchestration for the tally pipeline — discovers `.txt` files, skips ones already loaded, parses, writes into `TALLY_DB_PATH` (SQLite) in a transaction per file. |
| `src/tally/schema.sql` | `CREATE TABLE IF NOT EXISTS` for the tally SQLite db, run on every startup. |
| `src/config.ts` | Env parsing, source registry (raptor/sawfilers/porter/tally). |
| `src/db.ts` | Bronze PostgreSQL connection — schema/landing-table creation and watermarks. |
| `src/ingest.ts` | Scan orchestrator — lands every configured source into bronze with hash-dedupe and run history. Moved from NFLDataAPI. |
| `src/sources/` | Connectors: `sqliteSource`, `pgliteSource`. Moved from NFLDataAPI. |
| `src/mock/seedPorter.ts` | Porter stand-in database seeder. Moved from NFLDataAPI. |
| `src/run.ts` | CLI entrypoint: runs the tally pipeline, then scans all sources into bronze. |

The tally SQLite output isn't special-cased on the bronze side — it's just
another entry in the source registry (`type: sqlite`), landed through the
same generic connector as Raptor and Saw Filers.

## Running

```bash
npm install
cp .env.example .env   # then fill in paths — see below
./ops/setup-postgres.sh # provision the configured local role/database/schema
npm run seed:porter    # first time only, creates the mock Porter database
npm run run            # or ./start.sh / start.bat for install+build+run
```

See [SetupPG.md](./SetupPG.md) for PostgreSQL 17 installation, automated
provisioning, remote-server setup, and verification details.

Intended to be invoked on a schedule by external cron, not left running.

## Config

See `.env.example`. Configure the standard `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, and `PGPASSWORD` variables for the bronze PostgreSQL database. The
database and roles must be provisioned before running NFLETL; startup checks
the connection and then creates the idempotent bronze schema objects.

`@electric-sql/pglite` remains a dependency only for reading configured
PGlite source databases such as the Porter mock. Bronze itself is PostgreSQL.

## Sample data

`Examples/tally/` currently holds Sequoia Forest Products' report format as a
placeholder — real NFL tally reports weren't available yet when this was set
up. The filename convention and report structure are shared across mills
(same NBE Edger Optimizer vendor system), so the parser needs no changes once
real files land, but the actual customer name in the report body will be a
mismatch worth noting until then.

Note: `Examples/` (aside from this README) is gitignored — it's real
third-party data, not NFL's own, so it isn't checked in. A fresh clone won't
have it; populate it locally before running `npm run run`, or the tally
source will just be skipped.
