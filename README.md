# NFLETL

Standalone ETL for NFLDataAPI's bronze layer. Owns everything that writes to
the bronze database: parsing NBE Edger Optimizer Tally reports into their own
SQLite db, and scanning all configured sources (Raptor, Saw Filers, Porter,
and the tally output) into the shared bronze PGlite database. NFLDataAPI is a
read-only consumer of that same database — it no longer ingests anything
itself.

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
| `src/db.ts` | Bronze PGlite database — schema/landing-table creation, watermarks. Moved from NFLDataAPI. |
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
npm run seed:porter    # first time only, creates the mock Porter database
npm run run            # or ./start.sh / start.bat for install+build+run
```

Intended to be invoked on a schedule by external cron, not left running.

## Config

See `.env.example`. Key thing to get right: **`DB_PATH` must resolve to the
same directory as NFLDataAPI's `DB_PATH`** — this repo is the only writer to
bronze, NFLDataAPI just reads the same PGlite directory. Since the two repos
are separate checkouts, don't leave this as a bare relative path (that
silently creates a second, disconnected database) — point it explicitly at
NFLDataAPI's `data/` dir.

## Known risk: concurrent access to bronze.db

PGlite is not built for multi-process concurrent access the way WAL-mode
SQLite or a real Postgres server is. With NFLETL (writer) and NFLDataAPI
(reader) as separate processes opening the same PGlite data directory, a scan
running here at the same moment NFLDataAPI is serving a request could hit
lock contention or errors. This hasn't been load-tested — if it becomes a
problem, options include running NFLETL scans during low-traffic windows,
or moving bronze to a real Postgres instance both sides connect to over the
network instead of a shared embedded file.

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
