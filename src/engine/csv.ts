import { RESERVED_WORDS } from './parser';
import type { Database, Relation, Value } from './types';

/**
 * Turns CSV files into relations. The expected format is one header line of column names followed by
 * one line per row:
 *
 *   sid,name,major
 *   1,Ada,CS
 *   2,"Hopper, Grace",
 *
 * - Values are separated by commas; wrap a value in double quotes if it contains a comma, a quote ("")
 *   or a line break. Spaces around unquoted values are ignored.
 * - An empty value (or the word null) becomes null.
 * - A column whose values are all plain numbers is numeric, so year > 1970 and a.id < b.id compare
 *   as numbers. Anything else (including codes with leading zeros such as 007) stays text.
 * - Each file becomes one relation named after the file; names are adjusted so they can be typed in
 *   a query (Student ID → Student_ID). Duplicate rows are removed because a relation is a set.
 */

export class CsvError extends Error {}

export const CSV_LIMITS = { files: 10, bytes: 1_000_000, rows: 1000, columns: 40 };

export interface CsvFile {
  name: string;
  text: string;
}

export interface CsvRecord {
  /** Line number the record starts on (1-based), for error messages. */
  line: number;
  fields: string[];
}

export interface ImportedTable {
  relation: Relation;
  file: string;
  /** Things the student should know, e.g. renamed columns or removed duplicates. */
  notes: string[];
}

export interface ImportedDatabase {
  db: Database;
  tables: ImportedTable[];
}

const isNewline = (c: string | undefined) => c === '\n' || c === '\r';

/** RFC 4180 CSV: quoted fields may contain commas, "" (an escaped quote) and line breaks. */
export function parseCsv(text: string): CsvRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel writes a byte-order mark
  const records: CsvRecord[] = [];
  let i = 0;
  let line = 1;
  const skipNewline = () => {
    if (src[i] === '\r' && src[i + 1] === '\n') i++;
    i++;
    line++;
  };
  while (i < src.length) {
    const rec: CsvRecord = { line, fields: [] };
    for (;;) {
      while (src[i] === ' ' || src[i] === '\t') i++;
      if (src[i] === '"') {
        const opened = line;
        i++;
        let s = '';
        for (;;) {
          if (i >= src.length) throw new CsvError(`The quoted value that starts on line ${opened} is never closed. Check for a missing ".`);
          const c = src[i];
          if (c === '"') {
            if (src[i + 1] === '"') { s += '"'; i += 2; continue; }
            i++;
            break;
          }
          if (isNewline(c)) { s += '\n'; skipNewline(); continue; }
          s += c;
          i++;
        }
        while (src[i] === ' ' || src[i] === '\t') i++;
        if (i < src.length && src[i] !== ',' && !isNewline(src[i])) {
          throw new CsvError(`Line ${line} has text right after a closing quote. To put a quote inside a quoted value, write it twice ("").`);
        }
        rec.fields.push(s);
      } else {
        const start = i;
        while (i < src.length && src[i] !== ',' && !isNewline(src[i])) i++;
        rec.fields.push(src.slice(start, i).trim());
      }
      if (src[i] !== ',') break; // end of line or end of input
      i++;
    }
    records.push(rec);
    if (i < src.length) skipNewline();
  }
  return records;
}

/**
 * Make a name the query parser accepts: letters, digits and _, starting with a letter, and not a
 * keyword such as "join" or "not". Accents are dropped (Prénom → Prenom).
 */
export function toIdentifier(raw: string, fallback: string, digitPrefix: string): string {
  let s = raw.trim().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) return fallback;
  if (/^[0-9]/.test(s)) s = digitPrefix + s;
  if (RESERVED_WORDS.has(s.toLowerCase())) s += '_';
  return s;
}

/** Numbers without leading zeros (so IDs such as 007 stay text) and without precision loss. */
const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;
const isNumeric = (s: string) => NUMBER.test(s) && s.replace(/[-.]/g, '').length <= 15;

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base}_${k}`;
  taken.add(name.toLowerCase());
  return name;
}

/** Also called by the UI with the file's size, so a huge file is rejected before it is read. */
export function checkFileSize(fileName: string, size: number): void {
  if (size > CSV_LIMITS.bytes) throw new CsvError(`"${fileName}" is larger than ${CSV_LIMITS.bytes / 1_000_000} MB. This tool is for small example tables.`);
}

/** Build one relation from a parsed CSV file. `name` must already be a valid, unique relation name. */
export function relationFromCsv(file: CsvFile, name: string): ImportedTable {
  const where = `"${file.name}"`;
  checkFileSize(file.name, file.text.length);
  if (file.text.includes('\u0000')) throw new CsvError(`${where} is not a text file. Save it as CSV (comma separated values) and import that.`);

  const records = parseCsv(file.text).filter((r) => r.fields.some((f) => f !== ''));
  if (records.length === 0) throw new CsvError(`${where} is empty. Its first line must list the column names, e.g. id,name,city.`);
  const [head, ...body] = records;
  const notes: string[] = [];

  // Spreadsheets often leave blank cells at the end of the header ("a,b,c,"): ignore those columns.
  let width = head.fields.length;
  while (width > 1 && head.fields[width - 1] === '') width--;
  if (width > CSV_LIMITS.columns) throw new CsvError(`${where} has ${width} columns; the limit is ${CSV_LIMITS.columns}.`);
  if (body.length > CSV_LIMITS.rows) throw new CsvError(`${where} has ${body.length} rows; the limit is ${CSV_LIMITS.rows}.`);

  for (const r of body) {
    let n = r.fields.length;
    if (n > width) while (n > width && r.fields[n - 1] === '') n--; // tolerate trailing commas
    if (n !== width) {
      throw new CsvError(`Line ${r.line} of ${where} has ${n} value${n === 1 ? '' : 's'}, but the header (line ${head.line}) names ${width} column${width === 1 ? '' : 's'}. `
        + (n > width ? 'If a value contains a comma, wrap it in double quotes: "Smith, Jr.".' : 'Leave a value empty (e.g. 1,,3) to make it null.'));
    }
  }

  const taken = new Set<string>();
  const colNames = head.fields.slice(0, width).map((raw, c) => {
    const col = uniqueName(toIdentifier(raw, `col${c + 1}`, 'col_'), taken);
    if (!raw) notes.push(`Column ${c + 1} has no name, so it is called ${col}.`);
    else if (col !== raw) notes.push(`Column "${raw}" is called ${col} in queries.`);
    return col;
  });

  const cells = body.map((r) => r.fields.slice(0, width).map((f) => (f === '' || f.toLowerCase() === 'null' ? null : f)));
  const numeric = colNames.map((_, c) => cells.some((row) => row[c] !== null) && cells.every((row) => row[c] === null || isNumeric(row[c]!)));

  const seen = new Set<string>();
  const rows: Value[][] = [];
  for (const row of cells) {
    const typed: Value[] = row.map((v, c) => (v !== null && numeric[c] ? Number(v) : v));
    const key = JSON.stringify(typed);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(typed);
  }
  const dups = cells.length - rows.length;
  if (dups) notes.push(`${dups} duplicate row${dups === 1 ? ' was' : 's were'} removed (a relation is a set).`);

  return {
    file: file.name,
    notes,
    relation: { name, columns: colNames.map((c) => ({ name: c, rel: name })), rows },
  };
}

/** Import a set of CSV files as one database. Either every file imports or an error is thrown. */
export function importCsvFiles(files: CsvFile[]): ImportedDatabase {
  if (files.length === 0) throw new CsvError('No files were chosen.');
  if (files.length > CSV_LIMITS.files) throw new CsvError(`Import at most ${CSV_LIMITS.files} files at once.`);
  const taken = new Set<string>();
  const tables = files.map((f) => {
    if (!/\.csv$/i.test(f.name)) {
      throw new CsvError(`"${f.name}" is not a .csv file. In Excel or Google Sheets, use File → Save as / Download → CSV.`);
    }
    const stem = f.name.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '');
    const name = uniqueName(toIdentifier(stem, 'table', 'table_'), taken);
    const t = relationFromCsv(f, name);
    if (name !== stem) t.notes.unshift(`The table is called ${name} in queries.`);
    return t;
  });
  const db: Database = {};
  tables.forEach((t) => { db[t.relation.name] = t.relation; });
  return { db, tables };
}
