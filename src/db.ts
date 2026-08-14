import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new PGlite(config.dbPath);

export async function initDb() {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS bronze;

    CREATE TABLE IF NOT EXISTS bronze.ingest_runs (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL,
      tables_scanned INTEGER NOT NULL DEFAULT 0,
      rows_inserted INTEGER NOT NULL DEFAULT 0,
      rows_skipped INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS bronze.ingest_watermarks (
      source TEXT NOT NULL,
      source_table TEXT NOT NULL,
      last_rowid INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (source, source_table)
    );
  `);
}

// Watermarks let large append-only source tables be ingested incrementally
// (only rows newer than the last one seen) instead of a full rescan every cycle.
export async function getWatermark(source: string, table: string): Promise<number | null> {
  const result = await db.query<{ last_rowid: number }>(
    `SELECT last_rowid FROM bronze.ingest_watermarks WHERE source = $1 AND source_table = $2`,
    [source, table]
  );
  return result.rows[0]?.last_rowid ?? null;
}

export async function setWatermark(source: string, table: string, rowid: number): Promise<void> {
  await db.query(
    `INSERT INTO bronze.ingest_watermarks (source, source_table, last_rowid, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (source, source_table) DO UPDATE SET last_rowid = EXCLUDED.last_rowid, updated_at = EXCLUDED.updated_at`,
    [source, table, rowid, new Date().toISOString()]
  );
}

// Landing tables are one-per-source-table, named bronze.<source>__<table>.
// Rows land as JSONB payloads with lineage columns; row_hash dedupes rescans.
export function landingTableName(source: string, table: string): string {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return `${clean(source)}__${clean(table)}`;
}

export async function ensureLandingTable(name: string) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bronze."${name}" (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      source_table TEXT NOT NULL,
      payload JSONB NOT NULL,
      row_hash TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      ingested_at TIMESTAMPTZ NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "${name}_row_hash_idx" ON bronze."${name}" (row_hash);
  `);
}

export async function listLandingTables(): Promise<{ table_name: string; row_count: number }[]> {
  const tables = await db.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'bronze' AND table_name LIKE '%\\_\\_%'
    ORDER BY table_name;
  `);

  const results: { table_name: string; row_count: number }[] = [];
  for (const row of tables.rows) {
    const count = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM bronze."${row.table_name}"`
    );
    results.push({ table_name: row.table_name, row_count: count.rows[0].count });
  }
  return results;
}
