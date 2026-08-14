CREATE TABLE IF NOT EXISTS files (
    file_id         INTEGER PRIMARY KEY,
    filename        TEXT UNIQUE NOT NULL,
    filename_date   DATE NOT NULL,
    report_datetime TEXT NOT NULL,
    loaded_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS detail_lines (
    id         INTEGER PRIMARY KEY,
    file_id    INTEGER NOT NULL REFERENCES files(file_id),
    wood_type  TEXT NOT NULL,
    thickness  TEXT NOT NULL,
    width      REAL NOT NULL,
    grade      TEXT NOT NULL,
    length_ft  INTEGER NOT NULL,
    pieces     INTEGER NOT NULL,
    bd_ft      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS summary (
    file_id              INTEGER PRIMARY KEY REFERENCES files(file_id),
    time_start           TEXT,
    time_run             TEXT,
    time_no_production   TEXT,
    board_input_pieces   INTEGER,
    board_input_cuft     REAL,
    average_length_ft    REAL,
    edger_bd_ft          REAL,
    trim_pass_count      INTEGER,
    trim_pass_bd_ft      REAL,
    lumber_value         REAL,
    lumber_value_deducts REAL,
    recovery_lrf_bf_cm   REAL,
    recovery_bf_cf       REAL,
    fiber_ratio          REAL
);

CREATE TABLE IF NOT EXISTS solutions (
    id              INTEGER PRIMARY KEY,
    file_id         INTEGER NOT NULL REFERENCES files(file_id),
    solution_number INTEGER NOT NULL,
    board_count     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reject_reasons (
    id       INTEGER PRIMARY KEY,
    file_id  INTEGER NOT NULL REFERENCES files(file_id),
    reason   TEXT NOT NULL,
    count    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_detail_lines_file_id ON detail_lines(file_id);
CREATE INDEX IF NOT EXISTS idx_solutions_file_id ON solutions(file_id);
CREATE INDEX IF NOT EXISTS idx_reject_reasons_file_id ON reject_reasons(file_id);
