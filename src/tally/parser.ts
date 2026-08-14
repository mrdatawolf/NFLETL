// Parser for NBE Edger Optimizer Tally .txt reports.
// Ported from SFP_Tally_ETL's tally_parser.py — same report format across mills.

const FILENAME_RE = /tally(\d{2})(\d{2})(\d{2})-\d+\.txt$/;
const REPORT_DATETIME_RE = /^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})/m;
const SEPARATOR_RE = /^=+$/m;

const LENGTH_HEADER_RE = /(\d+)'/g;
const WOOD_BLOCK_RE = /^(\S+)\s+(\d+\/\d+)x([\d.]+)\s+(\S+)$/;
const PIECES_RE = /^pieces\s+(.+)$/;
const BDFT_RE = /^\s*bd[-_]ft\s+(.+)$/;

const TIME_RE = /Time:\s+Start\s+(\S+)\s+Run\s+(\S+)\s+No Production\s+(\S+)/;
const BOARD_INPUT_RE = /Board Input:\s+(\d+)\s+pieces\s+([\d.]+)\s+CuFt\s+Average Length\s+([\d.]+)'/;
const SOLUTION_HEADER_RE = /^\s*bd-ft\s+((?:\d+\s*)+)$/m;
const EDGER_RE = /^\s*Edger:\s+([\d.]+)\s+(.+)$/m;
const TRIM_PASS_RE = /Trim\s*\/\s*Pass\s+(\d+)\s+([\d.]+)\s+bdft/;
const LUMBER_VALUE_RE = /Lumber Value:\s+\$([\d.]+)\s+with Deducts:\s+\$([\d.]+)/;
const RECOVERY_RE = /Recovery:\s+LRF=([\d.]+)\s+bf\/cm\s+([\d.]+)\s+bf\/cf\s+Fiber Ratio=([\d.]+)/;

const REJECT_REASON_LABELS = [
  'Chip /Slash',
  'No Decision',
  'Manual',
  'Need Resawn',
  'Need Reedge',
  'Cut In Two',
  'Wane Down',
  'Skew Limit',
  'Too Thick',
  'Board Too Thin',
  'Too Long or Short',
  'Saw Limit',
  'Board Fit',
  'Sets missed by PLC'
];

export class TallyParseError extends Error {}

export type DetailRow = {
  wood_type: string;
  thickness: string;
  width: number;
  grade: string;
  length_ft: number;
  pieces: number;
  bd_ft: number;
};

export type SolutionRow = { solution_number: number; board_count: number };
export type RejectReasonRow = { reason: string; count: number };

export type TallySummary = {
  time_start: string;
  time_run: string;
  time_no_production: string;
  board_input_pieces: number;
  board_input_cuft: number;
  average_length_ft: number;
  edger_bd_ft: number;
  trim_pass_count: number;
  trim_pass_bd_ft: number;
  lumber_value: number;
  lumber_value_deducts: number;
  recovery_lrf_bf_cm: number;
  recovery_bf_cf: number;
  fiber_ratio: number;
};

export type ParsedTally = {
  filename: string;
  filename_date: string;
  report_datetime: string;
  detail_rows: DetailRow[];
  solutions: SolutionRow[];
  reject_reasons: RejectReasonRow[];
  summary: TallySummary;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches Python's re.escape(label).replace(r"\ ", r"\s*") — allow variable
// whitespace between words in a label since report formatting is inconsistent.
function labelPattern(label: string): RegExp {
  const pattern = label.split(' ').map(escapeRegex).join('\\s*');
  return new RegExp(`^\\s*${pattern}\\s+(\\d+)\\s*$`, 'm');
}

function parseFilenameDate(filename: string): string {
  const m = FILENAME_RE.exec(filename);
  if (!m) throw new TallyParseError(`filename does not match expected pattern: ${filename}`);
  const [, yy, mm, dd] = m;
  const year = 2000 + Number(yy);
  const month = Number(mm);
  const day = Number(dd);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new TallyParseError(`filename has an invalid date: ${filename}`);
  }
  return `${year.toString().padStart(4, '0')}-${mm}-${dd}`;
}

function parseReportDatetime(text: string): string {
  const m = REPORT_DATETIME_RE.exec(text);
  if (!m) throw new TallyParseError('could not find report date/time on line 2');
  const [, mm, dd, yy, timePart] = m;
  return `${2000 + Number(yy)}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')} ${timePart}`;
}

function parseDetails(detailsText: string): DetailRow[] {
  const lines = detailsText.split('\n');
  const headerLine = lines.find((line) => line.includes("'") && line.includes('Totals'));
  if (!headerLine) throw new TallyParseError('could not find details column header line');
  const lengths = [...headerLine.matchAll(LENGTH_HEADER_RE)].map((m) => Number(m[1]));

  const rows: DetailRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = WOOD_BLOCK_RE.exec(lines[i].trim());
    if (m) {
      const [, woodType, thickness, widthStr, grade] = m;
      const width = Number(widthStr);
      const piecesLine = lines[i + 1];
      const bdftLine = lines[i + 2];
      const pm = PIECES_RE.exec((piecesLine ?? '').trim());
      const bm = BDFT_RE.exec(bdftLine ?? '');
      if (!pm || !bm) {
        throw new TallyParseError(
          `expected pieces/bd-ft lines after '${lines[i]}', got: ${JSON.stringify(piecesLine)}, ${JSON.stringify(bdftLine)}`
        );
      }
      const piecesVals = pm[1].trim().split(/\s+/).map(Number);
      const bdftVals = bm[1].trim().split(/\s+/).map(Number);
      lengths.forEach((lengthFt, idx) => {
        rows.push({
          wood_type: woodType,
          thickness,
          width,
          grade,
          length_ft: lengthFt,
          pieces: piecesVals[idx],
          bd_ft: bdftVals[idx]
        });
      });
      i += 3;
    } else {
      i += 1;
    }
  }
  return rows;
}

function parseSummary(summaryText: string): { summary: TallySummary; solutions: SolutionRow[]; rejectReasons: RejectReasonRow[] } {
  const timeM = TIME_RE.exec(summaryText);
  if (!timeM) throw new TallyParseError('could not find Time: line');

  const boardInputM = BOARD_INPUT_RE.exec(summaryText);
  if (!boardInputM) throw new TallyParseError('could not find Board Input: line');

  const headerM = SOLUTION_HEADER_RE.exec(summaryText);
  const edgerM = EDGER_RE.exec(summaryText);
  if (!headerM || !edgerM) throw new TallyParseError('could not find solution header / Edger: line');
  const solutionNumbers = headerM[1].trim().split(/\s+/).map(Number);
  const boardCounts = edgerM[2].trim().split(/\s+/).map(Number);
  if (boardCounts.length !== solutionNumbers.length) {
    throw new TallyParseError(
      `solution header has ${solutionNumbers.length} columns but Edger: line has ${boardCounts.length} board counts`
    );
  }
  const solutions: SolutionRow[] = solutionNumbers.map((sn, idx) => ({ solution_number: sn, board_count: boardCounts[idx] }));

  const trimPassM = TRIM_PASS_RE.exec(summaryText);
  if (!trimPassM) throw new TallyParseError('could not find Trim / Pass line');

  const rejectReasons: RejectReasonRow[] = REJECT_REASON_LABELS.map((label) => {
    const m = labelPattern(label).exec(summaryText);
    if (!m) throw new TallyParseError(`could not find reject reason line: "${label}"`);
    return { reason: label, count: Number(m[1]) };
  });

  const lumberM = LUMBER_VALUE_RE.exec(summaryText);
  if (!lumberM) throw new TallyParseError('could not find Lumber Value: line');

  const recoveryM = RECOVERY_RE.exec(summaryText);
  if (!recoveryM) throw new TallyParseError('could not find Recovery: line');

  const summary: TallySummary = {
    time_start: timeM[1],
    time_run: timeM[2],
    time_no_production: timeM[3],
    board_input_pieces: Number(boardInputM[1]),
    board_input_cuft: Number(boardInputM[2]),
    average_length_ft: Number(boardInputM[3]),
    edger_bd_ft: Number(edgerM[1]),
    trim_pass_count: Number(trimPassM[1]),
    trim_pass_bd_ft: Number(trimPassM[2]),
    lumber_value: Number(lumberM[1]),
    lumber_value_deducts: Number(lumberM[2]),
    recovery_lrf_bf_cm: Number(recoveryM[1]),
    recovery_bf_cf: Number(recoveryM[2]),
    fiber_ratio: Number(recoveryM[3])
  };

  return { summary, solutions, rejectReasons };
}

export function parseTallyText(filename: string, rawText: string): ParsedTally {
  // JS regex "." excludes \r (unlike Python's), so CRLF-sourced files would
  // otherwise fail every end-of-line capture group. Normalize up front.
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const filenameDate = parseFilenameDate(filename);
  const reportDatetime = parseReportDatetime(text);

  const sepMatch = SEPARATOR_RE.exec(text);
  if (!sepMatch) throw new TallyParseError("could not find '====' separator between details and summary");
  const detailsText = text.slice(0, sepMatch.index);
  const summaryText = text.slice(sepMatch.index + sepMatch[0].length);

  const detailRows = parseDetails(detailsText);
  const { summary, solutions, rejectReasons } = parseSummary(summaryText);

  return {
    filename,
    filename_date: filenameDate,
    report_datetime: reportDatetime,
    detail_rows: detailRows,
    solutions,
    reject_reasons: rejectReasons,
    summary
  };
}
