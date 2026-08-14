export type SourceReader = {
  listTables(): Promise<string[]>;
  readRows(table: string): Promise<Record<string, unknown>[]>;
  // Optional: page through rows newer than a rowid watermark. Only meaningful
  // for tables known to be append-only (see INCREMENTAL_TABLES in ingest.ts).
  readRowsSince?(table: string, afterRowid: number, limit: number): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
};

// Internal bookkeeping tables in the source apps that we never land.
export const EXCLUDED_TABLES = new Set(['_prisma_migrations']);
