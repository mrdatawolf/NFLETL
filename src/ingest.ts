import crypto from 'node:crypto';
import { config, sourceAvailable, type SourceConfig } from './config.js';
import { db, ensureLandingTable, landingTableName, getWatermark, setWatermark } from './db.js';
import { openSqliteSource } from './sources/sqliteSource.js';
import { openPgliteSource } from './sources/pgliteSource.js';
import type { SourceReader } from './sources/reader.js';

const INSERT_CHUNK_SIZE = 1000;
const PAGE_SIZE = 50_000;

// Tables large enough that a full rescan every cycle is wasteful, and
// confirmed append-only (rows are written once and never updated), so a
// rowid watermark can never miss a change to an already-landed row.
const INCREMENTAL_TABLES = new Set(['raptor:ProductionBoardsPrevious']);

export type ScanResult = {
  source: string;
  status: 'ok' | 'skipped' | 'error';
  reason?: string;
  tables_scanned: number;
  rows_inserted: number;
  rows_skipped: number;
};

let scanInProgress = false;

function openReader(source: SourceConfig): SourceReader {
  return source.type === 'sqlite' ? openSqliteSource(source.path) : openPgliteSource(source.path);
}

// Stable stringify so the same row always hashes the same regardless of key order.
function rowHash(source: string, table: string, row: Record<string, unknown>): string {
  const sorted = Object.keys(row)
    .sort()
    .map((key) => [key, row[key]]);
  return crypto.createHash('sha256').update(`${source}|${table}|${JSON.stringify(sorted)}`).digest('hex');
}

async function landRows(
  source: string,
  table: string,
  rows: Record<string, unknown>[],
  batchId: string
): Promise<{ inserted: number; skipped: number }> {
  const landing = landingTableName(source, table);
  await ensureLandingTable(landing);

  let inserted = 0;
  const ingestedAt = new Date().toISOString();

  for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + INSERT_CHUNK_SIZE);
    const params: unknown[] = [];
    const values = chunk
      .map((row) => {
        params.push(source, table, JSON.stringify(row), rowHash(source, table, row), batchId, ingestedAt);
        const base = params.length - 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
      })
      .join(', ');

    const result = await db.query(
      `INSERT INTO bronze."${landing}" (source, source_table, payload, row_hash, batch_id, ingested_at)
       VALUES ${values}
       ON CONFLICT (row_hash) DO NOTHING`,
      params
    );
    inserted += result.affectedRows ?? 0;
  }

  return { inserted, skipped: rows.length - inserted };
}

async function ingestTable(
  reader: SourceReader,
  sourceName: string,
  table: string,
  batchId: string
): Promise<{ inserted: number; skipped: number }> {
  if (!reader.readRowsSince || !INCREMENTAL_TABLES.has(`${sourceName}:${table}`)) {
    const rows = await reader.readRows(table);
    return landRows(sourceName, table, rows, batchId);
  }

  let watermark = (await getWatermark(sourceName, table)) ?? 0;
  let inserted = 0;
  let skipped = 0;

  for (;;) {
    const rows = await reader.readRowsSince(table, watermark, PAGE_SIZE);
    if (rows.length === 0) break;

    const result = await landRows(sourceName, table, rows, batchId);
    inserted += result.inserted;
    skipped += result.skipped;

    for (const row of rows) {
      const rowid = row._rowid;
      if (typeof rowid === 'number' && rowid > watermark) watermark = rowid;
    }
    await setWatermark(sourceName, table, watermark);
    console.log(`[ingest] ${sourceName}.${table} watermark -> ${watermark} (+${rows.length} rows)`);

    if (rows.length < PAGE_SIZE) break;
  }

  return { inserted, skipped };
}

async function scanSource(source: SourceConfig): Promise<ScanResult> {
  if (!source.configured) {
    return { source: source.name, status: 'skipped', reason: 'No path configured', tables_scanned: 0, rows_inserted: 0, rows_skipped: 0 };
  }
  if (!sourceAvailable(source)) {
    return { source: source.name, status: 'skipped', reason: `Path not found: ${source.path}`, tables_scanned: 0, rows_inserted: 0, rows_skipped: 0 };
  }

  const startedAt = new Date().toISOString();
  const batchId = crypto.randomUUID();
  let tablesScanned = 0;
  let rowsInserted = 0;
  let rowsSkipped = 0;

  const reader = openReader(source);
  try {
    for (const table of await reader.listTables()) {
      const { inserted, skipped } = await ingestTable(reader, source.name, table, batchId);
      tablesScanned += 1;
      rowsInserted += inserted;
      rowsSkipped += skipped;
    }

    await db.query(
      `INSERT INTO bronze.ingest_runs (source, started_at, finished_at, status, tables_scanned, rows_inserted, rows_skipped)
       VALUES ($1, $2, $3, 'ok', $4, $5, $6)`,
      [source.name, startedAt, new Date().toISOString(), tablesScanned, rowsInserted, rowsSkipped]
    );
    return { source: source.name, status: 'ok', tables_scanned: tablesScanned, rows_inserted: rowsInserted, rows_skipped: rowsSkipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(
      `INSERT INTO bronze.ingest_runs (source, started_at, finished_at, status, tables_scanned, rows_inserted, rows_skipped, error)
       VALUES ($1, $2, $3, 'error', $4, $5, $6, $7)`,
      [source.name, startedAt, new Date().toISOString(), tablesScanned, rowsInserted, rowsSkipped, message]
    );
    return { source: source.name, status: 'error', reason: message, tables_scanned: tablesScanned, rows_inserted: rowsInserted, rows_skipped: rowsSkipped };
  } finally {
    await reader.close();
  }
}

export async function scanAllSources(only?: string): Promise<ScanResult[]> {
  if (scanInProgress) {
    throw new Error('A scan is already in progress');
  }
  scanInProgress = true;
  try {
    const targets = config.sources.filter((source) => !only || source.name === only);
    if (only && targets.length === 0) {
      throw new Error(`Unknown source "${only}"`);
    }

    const results: ScanResult[] = [];
    for (const source of targets) {
      results.push(await scanSource(source));
    }
    return results;
  } finally {
    scanInProgress = false;
  }
}
