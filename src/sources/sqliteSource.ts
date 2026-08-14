import Database from 'better-sqlite3';
import { EXCLUDED_TABLES, type SourceReader } from './reader.js';

export function openSqliteSource(filePath: string): SourceReader {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });

  return {
    async listTables() {
      const rows = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
        .all() as { name: string }[];
      return rows.map((row) => row.name).filter((name) => !EXCLUDED_TABLES.has(name));
    },

    async readRows(table: string) {
      // rowid gives every row a stable identity even when the table's own
      // columns could repeat; WITHOUT ROWID tables fall back to plain SELECT.
      try {
        return db.prepare(`SELECT rowid AS _rowid, * FROM "${table.replace(/"/g, '""')}"`).all() as Record<string, unknown>[];
      } catch {
        return db.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all() as Record<string, unknown>[];
      }
    },

    async readRowsSince(table, afterRowid, limit) {
      return db
        .prepare(`SELECT rowid AS _rowid, * FROM "${table.replace(/"/g, '""')}" WHERE rowid > ? ORDER BY rowid LIMIT ?`)
        .all(afterRowid, limit) as Record<string, unknown>[];
    },

    async close() {
      db.close();
    }
  };
}
