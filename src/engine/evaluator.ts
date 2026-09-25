import { attrToString, condToString, exprToString, fmtValue } from './parser';
import type { AttrRef, Column, Cond, Database, EvalResult, Expr, JoinOp, Operand, Relation, Stage, StepEvent, Value } from './types';

export class EvalError extends Error {}

/**
 * Only imported tables can get near these. Every compared pair is an animation frame (cheap), and
 * every result row is a table row in the page (expensive: stepping slows to seconds past ~5,000).
 */
export const MAX_JOIN_PAIRS = 50_000;
export const MAX_RESULT_ROWS = 5_000;

/** Label shown for a column: qualified (Movies.mID) only when the bare name is ambiguous inside the relation. */
export function columnLabels(r: Relation): string[] {
  return r.columns.map((c) => {
    const dup = r.columns.filter((o) => o.name.toLowerCase() === c.name.toLowerCase()).length > 1;
    return dup && c.rel ? `${c.rel}.${c.name}` : c.name;
  });
}

function findAttr(cols: Column[], ref: AttrRef, context: string): number {
  const hits: number[] = [];
  cols.forEach((c, i) => {
    if (c.name.toLowerCase() !== ref.name.toLowerCase()) return;
    if (ref.rel && (c.rel ?? '').toLowerCase() !== ref.rel.toLowerCase()) return;
    hits.push(i);
  });
  if (hits.length === 0) {
    const avail = cols.map((c) => (c.rel ? `${c.rel}.${c.name}` : c.name)).join(', ');
    throw new EvalError(`Unknown attribute "${attrToString(ref)}" in ${context}. Available: ${avail}`);
  }
  if (hits.length > 1) {
    const opts = hits.map((i) => `${cols[i].rel}.${cols[i].name}`).join(' or ');
    throw new EvalError(`"${attrToString(ref)}" is ambiguous in ${context} — write ${opts}`);
  }
  return hits[0];
}

// ---------- Conditions ----------

/** SQL's three-valued logic: null stands for "unknown", the result of any comparison with null. */
type Truth = boolean | null;

interface BoundCond {
  truth: (row: Value[]) => Truth;
  /** True only when the condition is true: σ and theta joins drop rows where it is false or unknown. */
  test: (row: Value[]) => boolean;
  /** Human readable trace with the row's values substituted in, e.g. "1980 ≥ 1970 ✓". */
  trace: (row: Value[]) => string;
  attrs: number[];
}

const mark = (t: Truth) => (t === null ? '?' : t ? '✓' : '✗');

function compare(a: Value, b: Value, op: string): boolean {
  return compare3(a, b, op) === true;
}

function compare3(a: Value, b: Value, op: string): Truth {
  if (a === null || b === null) return null; // comparisons with null are unknown, never true
  let x: string | number = a;
  let y: string | number = b;
  if (typeof x !== typeof y) {
    const nx = Number(x), ny = Number(y);
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) { x = nx; y = ny; } else { x = String(x); y = String(y); }
  }
  switch (op) {
    case '=': return x === y;
    case '!=': return x !== y;
    case '<': return x < y;
    case '<=': return x <= y;
    case '>': return x > y;
    case '>=': return x >= y;
  }
  return false;
}

const OP_TXT: Record<string, string> = { '=': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' };

function bindCond(c: Cond, cols: Column[], context: string): BoundCond {
  switch (c.kind) {
    case 'cmp': {
      const side = (o: Operand) => {
        if (o.kind === 'lit') return { get: () => o.value, idx: [] as number[] };
        const i = findAttr(cols, o.ref, context);
        return { get: (row: Value[]) => row[i], idx: [i] };
      };
      const l = side(c.l), r = side(c.r);
      return withTest({
        truth: (row) => compare3(l.get(row), r.get(row), c.op),
        trace: (row) => `${fmtValue(l.get(row))} ${OP_TXT[c.op]} ${fmtValue(r.get(row))}`,
        attrs: [...l.idx, ...r.idx],
      });
    }
    case 'not': {
      // ¬unknown is still unknown, so ¬(major = 'CS') does not keep rows whose major is null.
      const e = bindCond(c.e, cols, context);
      return withTest({
        truth: (row) => { const t = e.truth(row); return t === null ? null : !t; },
        trace: (row) => `¬(${e.trace(row)})`,
        attrs: e.attrs,
      });
    }
    case 'and':
    case 'or': {
      const l = bindCond(c.l, cols, context), r = bindCond(c.r, cols, context);
      const sym = c.kind === 'and' ? '∧' : '∨';
      // ∧: false beats unknown beats true.  ∨: true beats unknown beats false.
      const decisive = c.kind === 'or';
      return withTest({
        truth: (row) => {
          const a = l.truth(row), b = r.truth(row);
          if (a === decisive || b === decisive) return decisive;
          return a === null || b === null ? null : !decisive;
        },
        trace: (row) => `(${l.trace(row)} ${mark(l.truth(row))}) ${sym} (${r.trace(row)} ${mark(r.truth(row))})`,
        attrs: [...l.attrs, ...r.attrs],
      });
    }
  }
}

function withTest(c: Omit<BoundCond, 'test'>): BoundCond {
  return { ...c, test: (row) => c.truth(row) === true };
}

// ---------- Helpers ----------

const rowKey = (row: Value[]) => JSON.stringify(row);

function describeRow(r: Relation, row: Value[], idx: number[]): string {
  const labels = columnLabels(r);
  const cols = idx.length ? idx : [0];
  return cols.map((i) => `${labels[i]}=${fmtValue(row[i])}`).join(', ');
}

// ---------- Evaluation ----------

export function evaluate(expr: Expr, db: Database): EvalResult {
  const stages: Stage[] = [];

  function go(e: Expr): Relation {
    switch (e.kind) {
      case 'rel': {
        const key = Object.keys(db).find((k) => k.toLowerCase() === e.name.toLowerCase());
        if (!key) throw new EvalError(`Unknown relation "${e.name}". Available: ${Object.keys(db).join(', ')}`);
        return db[key];
      }
      case 'select': return select(e, go(e.child));
      case 'project': return project(e, go(e.child));
      case 'rename': return rename(e, go(e.child));
      case 'join': {
        const l = go(e.left);
        const r = go(e.right);
        return join(e, l, r);
      }
    }
  }

  function select(e: Extract<Expr, { kind: 'select' }>, input: Relation): Relation {
    const label = exprToString(e);
    const cond = bindCond(e.cond, input.columns, `σ[${condToString(e.cond)}]`);
    const out: Relation = { name: `T${stages.length + 1}`, columns: input.columns, rows: [] };
    const events: StepEvent[] = [];
    input.rows.forEach((row, i) => {
      const truth = cond.truth(row);
      const pass = truth === true;
      let o: number | undefined;
      if (pass) { o = out.rows.length; out.rows.push(row); }
      const verdict = pass ? 'true, keep the row' : truth === null ? 'unknown (it involves null), drop the row' : 'false, drop the row';
      events.push({ t: 'filter', row: i, pass, out: o, detail: `Row ${i + 1}: ${cond.trace(row)} → ${verdict}` });
    });
    stages.push({
      kind: 'select', symbol: 'σ', label, short: `σ[${condToString(e.cond)}](${input.name})`,
      summary: `Selection keeps only the rows where ${condToString(e.cond)} is true. Columns stay the same.`,
      inputs: [input], output: out, events, highlight: [unique(cond.attrs)],
    });
    return out;
  }

  function project(e: Extract<Expr, { kind: 'project' }>, input: Relation): Relation {
    const label = exprToString(e);
    const idx = e.attrs.map((a) => findAttr(input.columns, a, `π[${e.attrs.map(attrToString).join(', ')}]`));
    const out: Relation = { name: `T${stages.length + 1}`, columns: idx.map((i) => input.columns[i]), rows: [] };
    const seen = new Map<string, number>();
    const events: StepEvent[] = [];
    input.rows.forEach((row, i) => {
      const nr = idx.map((j) => row[j]);
      const k = rowKey(nr);
      const txt = `(${nr.map(fmtValue).join(', ')})`;
      if (seen.has(k)) {
        events.push({ t: 'project', row: i, dupOf: seen.get(k), detail: `Row ${i + 1} becomes ${txt} — already in the result, so the duplicate is removed` });
      } else {
        seen.set(k, out.rows.length);
        events.push({ t: 'project', row: i, out: out.rows.length, detail: `Row ${i + 1} becomes ${txt}` });
        out.rows.push(nr);
      }
    });
    stages.push({
      kind: 'project', symbol: 'π', label, short: `π[${e.attrs.map(attrToString).join(', ')}](${input.name})`,
      summary: `Projection keeps only the columns ${e.attrs.map(attrToString).join(', ')}. Rows that become identical are merged (a relation is a set).`,
      inputs: [input], output: out, events, highlight: [idx],
    });
    return out;
  }

  function rename(e: Extract<Expr, { kind: 'rename' }>, input: Relation): Relation {
    if (e.attrs && e.attrs.length !== input.columns.length) {
      throw new EvalError(`ρ[${e.newName}(…)] lists ${e.attrs.length} attribute names but the relation has ${input.columns.length} columns`);
    }
    const label = exprToString(e);
    const out: Relation = {
      name: e.newName,
      columns: input.columns.map((c, i) => ({ name: e.attrs ? e.attrs[i] : c.name, rel: e.newName })),
      rows: input.rows,
    };
    stages.push({
      kind: 'rename', symbol: 'ρ', label, short: `ρ[${e.newName}${e.attrs ? `(${e.attrs.join(', ')})` : ''}](${input.name})`,
      summary: `Rename gives the relation the name ${e.newName}${e.attrs ? ` and new attribute names` : ''}, so you can write ${e.newName}.${out.columns[0].name}. The data does not change.`,
      inputs: [input], output: out,
      events: input.rows.map((row, i) => ({ t: 'project', row: i, out: i, detail: `Row ${i + 1} is copied unchanged` })),
      highlight: [[]],
    });
    return out;
  }

  function join(e: Extract<Expr, { kind: 'join' }>, L: Relation, R: Relation): Relation {
    const label = exprToString(e);
    const op: JoinOp = e.op;
    const symbol = { product: '×', natural: '⋈', theta: '⋈', left: '⟕', right: '⟖', full: '⟗' }[op];
    const events: StepEvent[] = [];
    const pairs = L.rows.length * R.rows.length;
    if (pairs > MAX_JOIN_PAIRS) {
      throw new EvalError(`${label} would compare ${L.rows.length} × ${R.rows.length} = ${pairs.toLocaleString('en')} pairs of rows, which is too many to animate `
        + `(the limit is ${MAX_JOIN_PAIRS.toLocaleString('en')}). Use σ to keep fewer rows before joining.`);
    }

    // Natural-style joins (⋈, ⟕, ⟖, ⟗ without a condition) match on same-named attributes.
    const natural = op !== 'product' && !e.cond;
    let lKeys: number[] = [], rKeys: number[] = [];
    let columns: Column[];
    let rKeep: number[]; // right columns carried into the output
    let cond: BoundCond | undefined;

    if (natural) {
      L.columns.forEach((c, i) => {
        const rs = R.columns.map((rc, j) => (rc.name.toLowerCase() === c.name.toLowerCase() ? j : -1)).filter((j) => j >= 0);
        if (rs.length === 0) return;
        const ls = L.columns.filter((x) => x.name.toLowerCase() === c.name.toLowerCase()).length;
        if (rs.length > 1 || ls > 1) {
          throw new EvalError(`Natural join over "${c.name}" is ambiguous because it appears more than once on one side. Use ρ to rename, or a theta join ⋈[condition].`);
        }
        lKeys.push(i); rKeys.push(rs[0]);
      });
      rKeep = R.columns.map((_, j) => j).filter((j) => !rKeys.includes(j));
      columns = [...L.columns, ...rKeep.map((j) => R.columns[j])];
    } else {
      rKeep = R.columns.map((_, j) => j);
      columns = [...L.columns, ...R.columns];
      if (e.cond) {
        cond = bindCond(e.cond, columns, `${symbol}[${condToString(e.cond)}]`);
        lKeys = unique(cond.attrs.filter((i) => i < L.columns.length));
        rKeys = unique(cond.attrs.filter((i) => i >= L.columns.length).map((i) => i - L.columns.length));
      }
    }

    const out: Relation = { name: `T${stages.length + 1}`, columns, rows: [] };
    const lMatched = new Array(L.rows.length).fill(false);
    const rMatched = new Array(R.rows.length).fill(false);

    const keyText = (li: number, ri: number) => {
      const l = L.rows[li], r = R.rows[ri];
      if (natural) {
        if (lKeys.length === 0) return 'no common attributes, so every pair matches (same as ×)';
        const lab = columnLabels(L);
        return lKeys.map((k, n) => `${lab[k]}: ${fmtValue(l[k])} ${compare(l[k], r[rKeys[n]], '=') ? '=' : '≠'} ${fmtValue(r[rKeys[n]])}`).join(', ');
      }
      if (cond) return cond.trace([...l, ...r]);
      return 'every pair is combined';
    };

    L.rows.forEach((l, li) => {
      R.rows.forEach((r, ri) => {
        let match: boolean;
        if (op === 'product') match = true;
        else if (natural) match = lKeys.every((k, n) => compare(l[k], r[rKeys[n]], '='));
        else match = cond!.test([...l, ...r]);
        let o: number | undefined;
        if (match) {
          lMatched[li] = true; rMatched[ri] = true;
          o = out.rows.length;
          out.rows.push([...l, ...rKeep.map((j) => r[j])]);
        }
        const what = op === 'product' ? 'combine' : match ? 'match → joined row added' : 'no match';
        events.push({ t: 'pair', l: li, r: ri, match, out: o, detail: `${L.name} row ${li + 1} with ${R.name} row ${ri + 1}: ${keyText(li, ri)} — ${what}` });
      });
    });

    const padLeft = op === 'left' || op === 'full';
    const padRight = op === 'right' || op === 'full';

    if (padLeft) {
      const dangling = lMatched.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
      events.push({ t: 'phase', side: 'left', detail: dangling.length
        ? `Now the outer part: ${dangling.length} ${L.name} row(s) found no partner (dangling). ${symbol} keeps them anyway.`
        : `Outer part: every ${L.name} row found a partner, so there is nothing extra to keep.` });
      dangling.forEach((li) => {
        const o = out.rows.length;
        out.rows.push([...L.rows[li], ...rKeep.map(() => null)]);
        events.push({ t: 'pad', side: 'left', row: li, out: o, detail: `${L.name} row ${li + 1} (${describeRow(L, L.rows[li], lKeys)}) has no partner — kept, and the ${R.name} columns are filled with null` });
      });
    }
    if (padRight) {
      const dangling = rMatched.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
      events.push({ t: 'phase', side: 'right', detail: dangling.length
        ? `Now the outer part: ${dangling.length} ${R.name} row(s) found no partner (dangling). ${symbol} keeps them anyway.`
        : `Outer part: every ${R.name} row found a partner, so there is nothing extra to keep.` });
      dangling.forEach((ri) => {
        const r = R.rows[ri];
        const left: Value[] = L.columns.map((_, i) => {
          const n = natural ? lKeys.indexOf(i) : -1;
          return n >= 0 ? r[rKeys[n]] : null; // shared attributes take the right row's value
        });
        const o = out.rows.length;
        out.rows.push([...left, ...rKeep.map((j) => r[j])]);
        events.push({ t: 'pad', side: 'right', row: ri, out: o, detail: `${R.name} row ${ri + 1} (${describeRow(R, r, rKeys)}) has no partner — kept, and the ${L.name} columns are filled with null` });
      });
    }

    if (out.rows.length > MAX_RESULT_ROWS) {
      throw new EvalError(`${label} would produce ${out.rows.length.toLocaleString('en')} rows, which is too many to show (the limit is ${MAX_RESULT_ROWS.toLocaleString('en')}). `
        + `Use σ to keep fewer rows before joining${op === 'product' ? ', or join on a condition instead of ×' : ''}.`);
    }

    stages.push({
      kind: op, symbol, label, short: `${L.name} ${symbol}${e.cond ? `[${condToString(e.cond)}]` : ''} ${R.name}`,
      summary: joinSummary(op, natural, L, R, lKeys, e.cond),
      inputs: [L, R], output: out, events,
      highlight: [lKeys, rKeys],
      outFromLeft: L.columns.map((_, i) => i),
    });
    return out;
  }

  const result = go(expr);
  return { result, stages };
}

function unique(a: number[]): number[] {
  return [...new Set(a)];
}

function joinSummary(op: JoinOp, natural: boolean, L: Relation, R: Relation, lKeys: number[], cond?: Cond): string {
  const lab = columnLabels(L);
  const on = natural
    ? lKeys.length ? `rows that agree on ${lKeys.map((k) => lab[k]).join(', ')}` : 'every pair (there are no common attributes)'
    : cond ? `pairs where ${condToString(cond)} is true` : '';
  switch (op) {
    case 'product': return `Cartesian product pairs every ${L.name} row with every ${R.name} row (${L.rows.length} × ${R.rows.length} = ${L.rows.length * R.rows.length} rows). Nothing is filtered out.`;
    case 'natural': return `Natural join pairs up ${on}. The shared column appears once. Rows without a partner are dropped.`;
    case 'theta': return `Theta join = × followed by σ: it keeps ${on}. Both copies of shared column names are kept.`;
    case 'left': return `Left outer join pairs up ${on}, then also keeps every ${L.name} row that found no partner, filling the ${R.name} columns with null.`;
    case 'right': return `Right outer join pairs up ${on}, then also keeps every ${R.name} row that found no partner, filling the ${L.name} columns with null.`;
    case 'full': return `Full outer join pairs up ${on}, then keeps the partnerless rows from both sides, padding the missing side with null.`;
  }
}
