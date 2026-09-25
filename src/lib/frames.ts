import type { EvalResult, Stage, StepEvent } from '@/engine/types';

// Pure animation model: which frame we are on and what every row looks like at that frame.
// Ported unchanged from the original Player class so the step semantics stay identical.

export interface Frame {
  stage: number;
  /** -1 = introduction, events.length = step finished, otherwise index of the event being shown. */
  ev: number;
}

export interface FrameState {
  cur?: StepEvent;
  visibleOut: number;
  newestOut?: number;
  paddedOut: Set<number>;
  lMatched: Set<number>;
  rMatched: Set<number>;
  lDangling: Set<number>;
  rDangling: Set<number>;
  lDropped: Set<number>;
  rDropped: Set<number>;
  kept: Set<number>;
}

export function buildFrames(result: EvalResult): Frame[] {
  const frames: Frame[] = [];
  result.stages.forEach((s, si) => {
    for (let ev = -1; ev <= s.events.length; ev++) frames.push({ stage: si, ev });
  });
  return frames;
}

export function frameDelay(result: EvalResult, f: Frame, speed: number): number {
  const base = 1100 / speed;
  const stage = result.stages[f.stage];
  if (f.ev === -1) return base * 1.8;
  if (f.ev === stage.events.length) return base * 1.6;
  const e = stage.events[f.ev];
  if (e.t === 'phase') return base * 1.8;
  if (e.t === 'pair' && !e.match) return base * 0.7;
  return base;
}

export function computeState(s: Stage, ev: number): FrameState {
  const st: FrameState = {
    visibleOut: 0, paddedOut: new Set(), lMatched: new Set(), rMatched: new Set(),
    lDangling: new Set(), rDangling: new Set(), lDropped: new Set(), rDropped: new Set(), kept: new Set(),
  };
  const upto = Math.min(ev, s.events.length - 1);
  for (let i = 0; i <= upto; i++) {
    const e = s.events[i];
    if (e.t === 'pair' && e.match) { st.lMatched.add(e.l); st.rMatched.add(e.r); }
    if (e.t === 'pad') { (e.side === 'left' ? st.lDangling : st.rDangling).add(e.row); st.paddedOut.add(e.out); }
    if (e.t === 'filter') (e.pass ? st.kept : st.lDropped).add(e.row);
    if (e.t === 'project') (e.dupOf !== undefined ? st.lDropped : st.kept).add(e.row);
    if ('out' in e && e.out !== undefined) st.visibleOut = Math.max(st.visibleOut, e.out + 1);
  }
  if (ev >= 0 && ev < s.events.length) {
    st.cur = s.events[ev];
    if ('out' in st.cur && st.cur.out !== undefined) st.newestOut = st.cur.out;
    // A phase marker previews which rows are about to be rescued.
    if (st.cur.t === 'phase' && st.cur.side) {
      const rows = st.cur.side === 'left' ? s.inputs[0].rows : s.inputs[1].rows;
      const matched = st.cur.side === 'left' ? st.lMatched : st.rMatched;
      const target = st.cur.side === 'left' ? st.lDangling : st.rDangling;
      rows.forEach((_, i) => { if (!matched.has(i)) target.add(i); });
    }
  }
  if (ev === s.events.length) {
    st.visibleOut = s.output.rows.length;
    // Joins: rows that never matched and were not rescued by an outer join are dropped.
    if (s.inputs.length === 2) {
      s.inputs[0].rows.forEach((_, i) => { if (!st.lMatched.has(i) && !st.lDangling.has(i)) st.lDropped.add(i); });
      s.inputs[1].rows.forEach((_, i) => { if (!st.rMatched.has(i) && !st.rDangling.has(i)) st.rDropped.add(i); });
    }
  }
  return st;
}

export type RowState = 'idle' | 'matched' | 'kept' | 'dangling' | 'dropped';
export type CurState = 'ok' | 'bad' | 'pad' | null;

/** Classes for input row i of input k (0 = left / only input). */
export function inputRowState(s: Stage, st: FrameState, k: number, i: number): { cls: string[]; cur: CurState } {
  const isJoin = s.inputs.length === 2;
  const matched = k === 0 ? st.lMatched : st.rMatched;
  const dangling = k === 0 ? st.lDangling : st.rDangling;
  const dropped = k === 0 ? st.lDropped : st.rDropped;
  const cls: string[] = [];
  if (isJoin && matched.has(i)) cls.push('matched');
  if (!isJoin && st.kept.has(i)) cls.push('kept');
  if (dangling.has(i)) cls.push('dangling');
  const c = st.cur;
  let isCur = false, ok = true, pad = false;
  if (c?.t === 'pair') { isCur = (k === 0 ? c.l : c.r) === i; ok = c.match; }
  else if (c?.t === 'pad') { isCur = (c.side === 'left') === (k === 0) && c.row === i; pad = true; }
  else if (c?.t === 'filter') { isCur = c.row === i; ok = c.pass; }
  else if (c?.t === 'project') { isCur = c.row === i; ok = c.dupOf === undefined; }
  if (dropped.has(i) && !isCur) cls.push('dropped');
  const cur: CurState = isCur ? (pad ? 'pad' : ok ? 'ok' : 'bad') : null;
  if (cur) cls.push('cur', cur === 'pad' ? 'padcur' : cur);
  return { cls, cur };
}

export interface Narration {
  counter: string;
  text: string;
  tone: '' | 'ok' | 'bad' | 'pad' | 'final';
}

export function narrate(result: EvalResult, f: Frame, st: FrameState): Narration {
  const s = result.stages[f.stage];
  const total = s.events.filter((e) => e.t !== 'phase').length;
  const pos = s.events.slice(0, f.ev + 1).filter((e) => e.t !== 'phase').length;
  const counter = `Step ${f.stage + 1} of ${result.stages.length} · ${f.ev < 0 ? 'start' : f.ev >= s.events.length ? 'done' : `comparison ${pos} of ${total}`}`;
  let tone: Narration['tone'] = '';
  let text: string;
  if (f.ev === -1) {
    text = s.inputs.length === 2 && s.kind !== 'product'
      ? `Starting ${s.output.name} := ${s.short}. Each ${s.inputs[0].name} row will be compared with each ${s.inputs[1].name} row (${s.inputs[0].rows.length} × ${s.inputs[1].rows.length} = ${s.inputs[0].rows.length * s.inputs[1].rows.length} comparisons).`
      : `Starting ${s.output.name} := ${s.short}.`;
  } else if (f.ev >= s.events.length) {
    const isLast = f.stage === result.stages.length - 1;
    tone = isLast ? 'final' : '';
    const dropped = st.lDropped.size + st.rDropped.size;
    const extra = s.inputs.length === 2 && dropped > 0 && s.kind !== 'product'
      ? ` ${dropped} row(s) found no partner and ${s.kind === 'natural' || s.kind === 'theta' ? 'were dropped (dangling tuples).' : 'were not kept by this outer join.'}`
      : '';
    text = `${isLast ? 'Final result' : `${s.output.name} is done`}: ${s.output.rows.length} tuple(s), degree ${s.output.columns.length}.${extra}`;
  } else {
    const e = s.events[f.ev];
    text = e.detail;
    if (e.t === 'pair') tone = e.match ? 'ok' : 'bad';
    else if (e.t === 'pad' || e.t === 'phase') tone = 'pad';
    else if (e.t === 'filter') tone = e.pass ? 'ok' : 'bad';
    else if (e.t === 'project') tone = e.dupOf === undefined ? 'ok' : 'bad';
  }
  return { counter, text, tone };
}
