// Reads [{id, query, bachchan}] as JSON on stdin, prints the engine's results as JSON.
import { readFileSync } from 'node:fs';
import { parseQuery } from '../src/engine/parser';
import { evaluate, columnLabels } from '../src/engine/evaluator';
import { buildDatabase } from '../src/engine/data';
import { PRESETS } from '../src/engine/presets';

const input = JSON.parse(readFileSync(0, 'utf8')) as { id: string; query?: string; bachchan?: boolean }[];
const out = input.map((q) => {
  const p = PRESETS.find((x) => x.id === q.id);
  const query = q.query ?? p!.query;
  const bachchan = q.bachchan ?? p!.bachchan;
  const r = evaluate(parseQuery(query), buildDatabase(bachchan));
  return { id: q.id, query, bachchan, cols: columnLabels(r.result), rows: r.result.rows };
});
console.log(JSON.stringify(out));
