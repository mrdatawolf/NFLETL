import dotenv from 'dotenv';
import fs from 'node:fs';

dotenv.config();

export type SourceType = 'sqlite' | 'pglite';

export type SourceConfig = {
  name: string;
  type: SourceType;
  path: string;
  configured: boolean;
};

function readSource(name: string): SourceConfig {
  const prefix = name.toUpperCase();
  const type = (process.env[`${prefix}_TYPE`] || 'sqlite') as SourceType;
  const sourcePath = process.env[`${prefix}_PATH`] || '';

  if (type !== 'sqlite' && type !== 'pglite') {
    throw new Error(`${prefix}_TYPE must be "sqlite" or "pglite", got "${type}"`);
  }

  return { name, type, path: sourcePath, configured: sourcePath.length > 0 };
}

const tallyDbPath = process.env.TALLY_DB_PATH || './data/tally.db';

// The tally pipeline's own SQLite output is landed into bronze the same way
// as any externally-configured source, so it's appended to the registry
// here rather than read via readSource() (its path is fixed, not user-set).
const tallySource: SourceConfig = { name: 'tally', type: 'sqlite', path: tallyDbPath, configured: true };

const postgresUser = process.env.PGUSER || process.env.USER || 'postgres';

export const config = {
  postgres: {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || postgresUser,
    user: postgresUser
  },
  tallySourceDir: process.env.TALLY_SOURCE_DIR || './Examples/tally',
  tallyDbPath,
  sources: [readSource('raptor'), readSource('sawfilers'), readSource('porter'), tallySource]
};

export function sourceAvailable(source: SourceConfig): boolean {
  return source.configured && fs.existsSync(source.path);
}
