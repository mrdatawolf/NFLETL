// Loads NBE Edger Optimizer Tally .txt reports into a standalone SQLite db.
// Ported from SFP_Tally_ETL's etl.py. Already-loaded files (by filename) are
// skipped, so re-running is safe.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { TallyParseError, parseTallyText, type ParsedTally } from './parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getConnection(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schemaSql);
  return db;
}

function alreadyLoaded(db: Database.Database, filename: string): boolean {
  return db.prepare('SELECT 1 FROM files WHERE filename = ?').get(filename) !== undefined;
}

function insertFile(db: Database.Database, parsed: ParsedTally): void {
  const insert = db.transaction((p: ParsedTally) => {
    const fileResult = db
      .prepare('INSERT INTO files (filename, filename_date, report_datetime) VALUES (?, ?, ?)')
      .run(p.filename, p.filename_date, p.report_datetime);
    const fileId = fileResult.lastInsertRowid;

    const insertDetail = db.prepare(
      `INSERT INTO detail_lines (file_id, wood_type, thickness, width, grade, length_ft, pieces, bd_ft)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of p.detail_rows) {
      insertDetail.run(fileId, r.wood_type, r.thickness, r.width, r.grade, r.length_ft, r.pieces, r.bd_ft);
    }

    const s = p.summary;
    db.prepare(
      `INSERT INTO summary
       (file_id, time_start, time_run, time_no_production, board_input_pieces,
        board_input_cuft, average_length_ft, edger_bd_ft, trim_pass_count,
        trim_pass_bd_ft, lumber_value, lumber_value_deducts, recovery_lrf_bf_cm,
        recovery_bf_cf, fiber_ratio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fileId,
      s.time_start,
      s.time_run,
      s.time_no_production,
      s.board_input_pieces,
      s.board_input_cuft,
      s.average_length_ft,
      s.edger_bd_ft,
      s.trim_pass_count,
      s.trim_pass_bd_ft,
      s.lumber_value,
      s.lumber_value_deducts,
      s.recovery_lrf_bf_cm,
      s.recovery_bf_cf,
      s.fiber_ratio
    );

    const insertSolution = db.prepare('INSERT INTO solutions (file_id, solution_number, board_count) VALUES (?, ?, ?)');
    for (const r of p.solutions) {
      insertSolution.run(fileId, r.solution_number, r.board_count);
    }

    const insertReject = db.prepare('INSERT INTO reject_reasons (file_id, reason, count) VALUES (?, ?, ?)');
    for (const r of p.reject_reasons) {
      insertReject.run(fileId, r.reason, r.count);
    }
  });

  insert(parsed);
}

export type TallyEtlResult = { loaded: number; skipped: number; failed: number };

export async function runTallyEtl(): Promise<TallyEtlResult> {
  const db = getConnection(config.tallyDbPath);

  let loaded = 0;
  let skipped = 0;
  let failed = 0;

  try {
    if (!fs.existsSync(config.tallySourceDir)) {
      console.log(`[tally] source dir not found, skipping: ${config.tallySourceDir}`);
      return { loaded, skipped, failed };
    }

    const filenames = fs
      .readdirSync(config.tallySourceDir)
      .filter((name) => name.endsWith('.txt'))
      .sort();

    for (const filename of filenames) {
      if (alreadyLoaded(db, filename)) {
        skipped += 1;
        continue;
      }
      const filePath = path.join(config.tallySourceDir, filename);
      try {
        const text = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseTallyText(filename, text, config.tallyDataVersion);
        insertFile(db, parsed);
        loaded += 1;
        console.log(`[tally] loaded  ${filename}`);
      } catch (error) {
        failed += 1;
        const message = error instanceof TallyParseError ? error.message : String(error);
        console.error(`[tally] FAILED  ${filename}: ${message}`);
      }
    }

    console.log(`[tally] ${loaded} loaded, ${skipped} skipped, ${failed} failed`);
    return { loaded, skipped, failed };
  } finally {
    db.close();
  }
}
