// Stands in for the Porter vendor database until we get real access.
// Creates a standalone PGlite database that the ingest layer treats exactly
// like an external source, so swapping in the real thing later only means
// changing PORTER_TYPE/PORTER_PATH in .env.
//
// Usage: npm run seed:porter [-- --fresh]   (--fresh wipes and reseeds)
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.js';

const porter = config.sources.find((source) => source.name === 'porter');
if (!porter || !porter.configured) {
  console.error('PORTER_PATH is not set in .env');
  process.exit(1);
}

if (process.argv.includes('--fresh') && fs.existsSync(porter.path)) {
  fs.rmSync(porter.path, { recursive: true });
  console.log(`Removed existing mock at ${porter.path}`);
}

fs.mkdirSync(path.dirname(porter.path), { recursive: true });
const db = new PGlite(porter.path);

// Deterministic RNG so reseeding produces the same data set.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260724);
const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];

const MACHINES = ['Headrig', 'Edger', 'Trimmer', 'Gang Saw', 'Planer'];
const PRODUCTS = ['2x4x8', '2x4x10', '2x6x12', '1x6x16', '4x4x8'];
const SHIFTS = ['Day', 'Night'];
const DOWNTIME_REASONS = [
  ['Saw change', 'planned'],
  ['Jam / plug-up', 'unplanned'],
  ['Electrical fault', 'unplanned'],
  ['Scheduled maintenance', 'planned'],
  ['Waiting on logs', 'operational'],
  ['Shift change', 'operational']
];
const SAW_ACTIONS = ['Installed', 'Removed', 'Sharpened', 'Benched', 'Retipped'];
const FILERS = ['J. Miller', 'D. Boone', 'T. Nguyen', 'R. Castillo'];

await db.exec(`
  CREATE TABLE IF NOT EXISTS production_tally (
    id SERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL,
    shift TEXT NOT NULL,
    machine TEXT NOT NULL,
    product TEXT NOT NULL,
    piece_count INTEGER NOT NULL,
    volume_bf NUMERIC NOT NULL
  );

  CREATE TABLE IF NOT EXISTS downtime_events (
    id SERIAL PRIMARY KEY,
    machine TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    category TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saw_maintenance (
    id SERIAL PRIMARY KEY,
    saw_number TEXT NOT NULL,
    action TEXT NOT NULL,
    performed_by TEXT NOT NULL,
    performed_at TIMESTAMPTZ NOT NULL,
    notes TEXT
  );
`);

const existing = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM production_tally');
if (existing.rows[0].count > 0) {
  console.log(`Porter mock already seeded (${existing.rows[0].count} tally rows). Use --fresh to reseed.`);
  await db.close();
  process.exit(0);
}

const DAYS = 30;
const now = new Date();
let tallyRows = 0;
let downtimeRows = 0;
let maintenanceRows = 0;

for (let dayOffset = DAYS; dayOffset >= 1; dayOffset--) {
  const day = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 6, 0, 0);

  // ~8 tally entries per machine per day across two shifts
  for (const machine of MACHINES) {
    for (let entry = 0; entry < 8; entry++) {
      const recordedAt = new Date(dayStart.getTime() + entry * 2 * 60 * 60 * 1000 + rand() * 60 * 60 * 1000);
      const pieces = 200 + Math.floor(rand() * 400);
      await db.query(
        `INSERT INTO production_tally (recorded_at, shift, machine, product, piece_count, volume_bf)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [recordedAt.toISOString(), entry < 4 ? SHIFTS[0] : SHIFTS[1], machine, pick(PRODUCTS), pieces, Math.round(pieces * (2 + rand() * 6) * 100) / 100]
      );
      tallyRows++;
    }
  }

  const downtimeCount = 3 + Math.floor(rand() * 8);
  for (let entry = 0; entry < downtimeCount; entry++) {
    const [reason, category] = pick(DOWNTIME_REASONS);
    const startedAt = new Date(dayStart.getTime() + rand() * 16 * 60 * 60 * 1000);
    const endedAt = new Date(startedAt.getTime() + (5 + rand() * 55) * 60 * 1000);
    await db.query(
      `INSERT INTO downtime_events (machine, started_at, ended_at, reason, category) VALUES ($1, $2, $3, $4, $5)`,
      [pick(MACHINES), startedAt.toISOString(), endedAt.toISOString(), reason, category]
    );
    downtimeRows++;
  }

  const maintenanceCount = 4 + Math.floor(rand() * 6);
  for (let entry = 0; entry < maintenanceCount; entry++) {
    const performedAt = new Date(dayStart.getTime() + rand() * 16 * 60 * 60 * 1000);
    await db.query(
      `INSERT INTO saw_maintenance (saw_number, action, performed_by, performed_at, notes) VALUES ($1, $2, $3, $4, $5)`,
      [`S-${100 + Math.floor(rand() * 60)}`, pick(SAW_ACTIONS), pick(FILERS), performedAt.toISOString(), rand() < 0.3 ? 'Follow-up needed' : null]
    );
    maintenanceRows++;
  }
}

console.log(`Seeded Porter mock at ${porter.path}:`);
console.log(`  production_tally: ${tallyRows} rows`);
console.log(`  downtime_events:  ${downtimeRows} rows`);
console.log(`  saw_maintenance:  ${maintenanceRows} rows`);
await db.close();
