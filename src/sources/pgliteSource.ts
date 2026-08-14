import { PGlite } from '@electric-sql/pglite';
import { EXCLUDED_TABLES, type SourceReader } from './reader.js';

export function openPgliteSource(dataDir: string): SourceReader {
  const db = new PGlite(dataDir);

  return {
    async listTables() {
      const result = await db.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);
      return result.rows.map((row) => row.table_name).filter((name) => !EXCLUDED_TABLES.has(name));
    },

    async readRows(table: string) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM public."${table.replace(/"/g, '""')}"`
      );
      return result.rows;
    },

    async close() {
      await db.close();
    }
  };
}
