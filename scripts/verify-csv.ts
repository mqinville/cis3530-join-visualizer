// Checks the CSV importer (src/engine/csv.ts) against hand-written expectations: parsing edge cases,
// type inference, name clean-up, and the error messages students see for malformed files.
// Run:  bun scripts/verify-csv.ts
import { CSV_LIMITS, CsvError, importCsvFiles, parseCsv, type CsvFile } from '../src/engine/csv';
import { evaluate, EvalError, MAX_JOIN_PAIRS, MAX_RESULT_ROWS } from '../src/engine/evaluator';
import { parseQuery } from '../src/engine/parser';
import type { Database } from '../src/engine/types';

let fails = 0, total = 0;
const show = (v: unknown) => JSON.stringify(v);

function eq(name: string, got: unknown, want: unknown) {
  total++;
  const ok = show(got) === show(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) { console.log('   got: ', show(got)); console.log('   want:', show(want)); }
}

function throws(name: string, fn: () => unknown, cls: new (...a: never[]) => Error, pattern: RegExp) {
  total++;
  let msg = '(no error)';
  let ok = false;
  try { fn(); } catch (err) { msg = (err as Error).message; ok = err instanceof cls && pattern.test(msg); }
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`   ${ok ? '→' : 'got:'} ${msg}`);
}

const fields = (text: string) => parseCsv(text).map((r) => r.fields);
const one = (name: string, text: string) => importCsvFiles([{ name, text }]).tables[0];
const table = (name: string, text: string) => {
  const t = one(name, text);
  return { name: t.relation.name, cols: t.relation.columns.map((c) => c.name), rows: t.relation.rows, notes: t.notes };
};
const run = (db: Database, q: string) => evaluate(parseQuery(q), db).result.rows;

// ---------- Parsing (RFC 4180) ----------

eq('parse: header and rows', fields('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
eq('parse: no trailing newline', fields('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
eq('parse: CRLF and lone CR line endings', fields('a,b\r\n1,2\r3,4\r\n'), [['a', 'b'], ['1', '2'], ['3', '4']]);
eq('parse: UTF-8 byte-order mark is dropped', fields('﻿id,name\n1,x'), [['id', 'name'], ['1', 'x']]);
eq('parse: spaces around unquoted values are trimmed', fields(' a , b \n 1 ,  2'), [['a', 'b'], ['1', '2']]);
eq('parse: quoted comma, escaped quote, kept spaces', fields('"Smith, Jr.","say ""hi""","  x  "'), [['Smith, Jr.', 'say "hi"', '  x  ']]);
eq('parse: line break inside quotes', fields('id,note\n1,"two\nlines"\n2,ok'), [['id', 'note'], ['1', 'two\nlines'], ['2', 'ok']]);
eq('parse: line numbers after a multi-line value', parseCsv('id,note\n1,"a\nb"\n2,c').map((r) => r.line), [1, 2, 4]);
eq('parse: empty values and trailing comma', fields('a,,c,'), [['a', '', 'c', '']]);
eq('parse: quote inside an unquoted value is literal', fields('5\'9",x'), [['5\'9"', 'x']]);
throws('parse: unterminated quote', () => parseCsv('a,b\n1,"oops\n2,3\n'), CsvError, /starts on line 2 is never closed/);
throws('parse: text after closing quote', () => parseCsv('a\n"x"y'), CsvError, /Line 2 has text right after a closing quote/);

// ---------- Types, nulls, set semantics ----------

eq('types: numbers per column, text otherwise', table('t.csv', 'i,d,neg,zip,mixed,big\n1,1.5,-3,007,1,12345678901234567\n20,0.25,0,010,a,1').rows,
  [[1, 1.5, -3, '007', '1', '12345678901234567'], [20, 0.25, 0, '010', 'a', '1']]);
eq('types: empty cells and the word null are null', table('t.csv', 'a,b,c\n1,,NULL\n2,x,null\n3,"",y').rows,
  [[1, null, null], [2, 'x', null], [3, null, 'y']]);
eq('types: an all-null column', table('t.csv', 'a,b\n1,\n2,').rows, [[1, null], [2, null]]);
eq('types: forms that are not plain numbers stay text', table('t.csv', 'v\n1e3\n+5\n.5\n"1,000"\n').rows, [['1e3'], ['+5'], ['.5'], ['1,000']]);
eq('set semantics: duplicate rows removed, with a note', table('t.csv', 'a,b\n1,x\n1,x\n 1 , x \n2,y').rows, [[1, 'x'], [2, 'y']]);
eq('set semantics: note text', table('t.csv', 'a\n1\n1\n1').notes, ['2 duplicate rows were removed (a relation is a set).']);
eq('header only: zero rows', table('t.csv', 'a,b\n').rows, []);
eq('blank lines are ignored', table('t.csv', '\n\na,b\n\n1,2\n,\n\n3,4\n\n').rows, [[1, 2], [3, 4]]);

// ---------- Names ----------

eq('names: headers become identifiers', table('t.csv', 'Student ID,Prénom,2023,join,not,,id,ID\n1,2,3,4,5,6,7,8\n').cols,
  ['Student_ID', 'Prenom', 'col_2023', 'join_', 'not_', 'col6', 'id', 'ID_2']);
eq('names: notes explain each rename', table('t.csv', 'Student ID,,a\n1,2,3').notes,
  ['Column "Student ID" is called Student_ID in queries.', 'Column 2 has no name, so it is called col2.']);
eq('names: table named after the file', ['My Data (2).csv', 'join.csv', '2024.csv', 'grades.CSV', 'dir/sub/x.csv'].map((n) => one(n, 'a\n1').relation.name),
  ['My_Data_2', 'join_', 'table_2024', 'grades', 'x']);
eq('names: tables unique ignoring case', importCsvFiles([{ name: 'a.csv', text: 'x\n1' }, { name: 'A.csv', text: 'y\n2' }]).tables.map((t) => t.relation.name), ['a', 'A_2']);
eq('names: trailing blank header cells are dropped', table('t.csv', 'a,b,,\n1,2,,\n3,4\n').cols, ['a', 'b']);

// ---------- Errors students can hit ----------

throws('error: too many values on a line', () => one('t.csv', 'a,b\n1,2\nSmith, Jr.,3\n'), CsvError, /Line 3 of "t.csv" has 3 values, but the header \(line 1\) names 2 columns\. If a value contains a comma/);
throws('error: too few values on a line', () => one('t.csv', 'a,b,c\n1,2,3\n4,5\n'), CsvError, /Line 3 of "t.csv" has 2 values.*names 3 columns\. Leave a value empty/);
throws('error: empty file', () => one('t.csv', '\n \n'), CsvError, /"t.csv" is empty/);
throws('error: not a .csv file', () => importCsvFiles([{ name: 'grades.xlsx', text: 'PK\u0003\u0004' }]), CsvError, /"grades.xlsx" is not a \.csv file/);
throws('error: binary content', () => one('t.csv', 'a\u0000b'), CsvError, /not a text file/);
throws('error: too many rows', () => one('t.csv', 'a\n' + Array.from({ length: CSV_LIMITS.rows + 1 }, (_, i) => i).join('\n')), CsvError, /has 1001 rows; the limit is 1000/);
throws('error: too many columns', () => one('t.csv', Array.from({ length: CSV_LIMITS.columns + 1 }, (_, i) => `c${i}`).join(',')), CsvError, /has 41 columns; the limit is 40/);
throws('error: too large', () => one('t.csv', 'a\n' + 'x'.repeat(CSV_LIMITS.bytes)), CsvError, /larger than 1 MB/);
throws('error: too many files', () => importCsvFiles(Array.from({ length: 11 }, (_, i) => ({ name: `t${i}.csv`, text: 'a\n1' }))), CsvError, /at most 10 files/);
throws('error: nothing chosen', () => importCsvFiles([]), CsvError, /No files were chosen/);
throws('error: one bad file fails the whole import', () => importCsvFiles([{ name: 'ok.csv', text: 'a\n1' }, { name: 'bad.csv', text: 'a,b\n1' }]), CsvError, /Line 2 of "bad.csv"/);

// ---------- Querying imported tables ----------

const files: CsvFile[] = [
  { name: 'Student List.csv', text: 'Student ID,Prénom,not\n1,Zoé,x\n2,Li,y\n' },
  { name: 'marks.csv', text: 'Student_ID,mark\n1,90\n1,75\n3,60\n' },
];
const db = importCsvFiles(files).db;
eq('query: cleaned names can be typed', run(db, "π[Student_ID](σ[Prenom = 'Zoé'](Student_List))"), [[1]]);
eq('query: a column called "not" is usable as not_', run(db, "π[not_](Student_List)"), [['x'], ['y']]);
eq('query: natural join on the cleaned name', run(db, 'π[Prenom, mark](Student_List ⋈ marks)'), [['Zoé', 90], ['Zoé', 75]]);
eq('query: numbers compare as numbers', run(db, 'σ[mark > 70](marks)'), [[1, 90], [1, 75]]);
eq('query: unknown truth value drops the row', run(importCsvFiles([{ name: 't.csv', text: 'a,b\n1,\n2,x\n' }]).db, "σ[¬(b = 'x')](t)"), []);
throws('query: unknown relation lists the imported ones', () => run(db, 'students ⋈ marks'), EvalError, /Unknown relation "students"\. Available: Student_List, marks/);
throws('query: unknown attribute', () => run(db, 'π[gpa](marks)'), EvalError, /Unknown attribute "gpa".*Available: marks\.Student_ID, marks\.mark/);
throws('query: ambiguous attribute', () => run(db, 'π[Student_ID](Student_List ⋈[Student_List.Student_ID = marks.Student_ID] marks)'), EvalError, /ambiguous/);

// Joins are capped: every compared pair is an animation frame, and every result row is a row in the page.
const big = (n: number) => importCsvFiles([{ name: 'big.csv', text: 'k\n' + Array.from({ length: n }, (_, i) => i).join('\n') }]).db;
const side = Math.floor(Math.sqrt(MAX_JOIN_PAIRS));
eq(`limits: ${side} × ${side} pairs with a small result is allowed`, run(big(side), 'ρ[A](big) ⋈[A.k = B.k] ρ[B](big)').length, side);
throws(`limits: ${side + 1} × ${side + 1} pairs is refused`, () => run(big(side + 1), 'ρ[A](big) ⋈[A.k = B.k] ρ[B](big)'), EvalError, /50,176 pairs of rows, which is too many to animate.*Use σ/);
const rows = Math.floor(Math.sqrt(MAX_RESULT_ROWS));
eq(`limits: ${rows} × ${rows} = ${rows * rows} result rows is allowed`, run(big(rows), 'ρ[A](big) × ρ[B](big)').length, rows * rows);
throws(`limits: ${rows + 1} × ${rows + 1} result rows is refused`, () => run(big(rows + 1), 'ρ[A](big) × ρ[B](big)'), EvalError, /would produce 5,041 rows, which is too many to show.*instead of ×/);
throws('limits: a selective σ afterwards does not help (the join is too big)', () => run(big(rows + 1), 'σ[A.k = B.k](ρ[A](big) × ρ[B](big))'), EvalError, /too many to show/);
eq('limits: σ first keeps it small', run(big(rows + 1), 'σ[k < 10](ρ[A](big)) × σ[k < 10](ρ[B](big))').length, 100);

console.log(`\n${total - fails}/${total} CSV import checks passed`);
process.exit(fails ? 1 : 0);
