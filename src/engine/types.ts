export type Value = string | number | null;

/** A column knows its attribute name and which relation it came from (used for Movies.mID style references). */
export interface Column {
  name: string;
  rel: string | null;
}

export interface Relation {
  name: string;
  columns: Column[];
  rows: Value[][];
}

export type Database = Record<string, Relation>;

// ---------- Query AST ----------

export interface AttrRef {
  rel?: string;
  name: string;
}

export type Operand = { kind: 'attr'; ref: AttrRef } | { kind: 'lit'; value: Value };

export type CmpOp = '=' | '!=' | '<' | '<=' | '>' | '>=';

export type Cond =
  | { kind: 'and' | 'or'; l: Cond; r: Cond }
  | { kind: 'not'; e: Cond }
  | { kind: 'cmp'; op: CmpOp; l: Operand; r: Operand };

export type JoinOp = 'product' | 'natural' | 'theta' | 'left' | 'right' | 'full';

export type Expr =
  | { kind: 'rel'; name: string }
  | { kind: 'select'; cond: Cond; child: Expr }
  | { kind: 'project'; attrs: AttrRef[]; child: Expr }
  | { kind: 'rename'; newName: string; attrs?: string[]; child: Expr }
  | { kind: 'join'; op: JoinOp; cond?: Cond; left: Expr; right: Expr };

// ---------- Animation steps produced by the evaluator ----------

export type StepEvent =
  /** A left row is compared with a right row (joins and products). */
  | { t: 'pair'; l: number; r: number; match: boolean; out?: number; detail: string }
  /** An unmatched (dangling) row is kept by an outer join and padded with nulls. */
  | { t: 'pad'; side: 'left' | 'right'; row: number; out: number; detail: string }
  /** A row is tested against a selection condition. */
  | { t: 'filter'; row: number; pass: boolean; out?: number; detail: string }
  /** A row is cut down to the projected columns (dupOf = it collapsed into an existing row). */
  | { t: 'project'; row: number; out?: number; dupOf?: number; detail: string }
  /** A narrative marker, e.g. "now looking for dangling tuples". */
  | { t: 'phase'; side?: 'left' | 'right'; detail: string };

export type StageKind = 'select' | 'project' | 'rename' | JoinOp;

export interface Stage {
  kind: StageKind;
  symbol: string;
  /** Expression text for this sub-query, e.g. "Artists ⋈ Roles". */
  label: string;
  /** The same step written with input names only, e.g. "T1 ⋈ Movies". */
  short: string;
  /** Plain-language description of what this operator does. */
  summary: string;
  inputs: Relation[];
  output: Relation;
  events: StepEvent[];
  /** Column indexes to highlight in each input (join keys, condition attributes, projected attrs). */
  highlight: number[][];
  /** Column indexes in the output that came from each side, for joins. */
  outFromLeft?: number[];
}

export interface EvalResult {
  result: Relation;
  stages: Stage[];
}
