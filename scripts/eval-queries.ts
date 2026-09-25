// Reads [{id, query, bachchan, csv}] as JSON on stdin, prints the engine's results as JSON.
// `csv` lists CSV file paths to import (as the UI's import does) instead of using the course tables.
// A query that fails comes back as {id, error} instead of rows.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseQuery } from '../src/engine/parser';
import { evaluate, columnLabels } from '../src/engine/evaluator';
import { buildDatabase } from '../src/engine/data';
import { importCsvFiles } from '../src/engine/csv';
import { PRESETS } from '../src/engine/presets';

type Req = { id: string; query?: string; bachchan?: boolean; csv?: string[] };

const input = JSON.parse(readFileSync(0, 'utf8')) as Req[];
const out = input.map((q) => {
  const p = PRESETS.find((x) => x.id === q.id);
  const query = q.query ?? p!.query;
  const bachchan = q.bachchan ?? p?.bachchan ?? false;
  try {
    const db = q.csv
      ? importCsvFiles(q.csv.map((f) => ({ name: path.basename(f), text: readFileSync(f, 'utf8') }))).db
      : buildDatabase(bachchan);
    const r = evaluate(parseQuery(query), db);
    return { id: q.id, query, bachchan, csv: q.csv, cols: columnLabels(r.result), rows: r.result.rows };
  } catch (err) {
    return { id: q.id, query, bachchan, csv: q.csv, error: (err as Error).message };
  }
});
console.log(JSON.stringify(out));
