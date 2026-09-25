import type { AttrRef, CmpOp, Cond, Expr, JoinOp, Operand } from './types';

/**
 * Grammar (precedence follows slide 50: σ, π, ρ bind tightest, then ×/⋈ variants, left-associative):
 *
 *   expr    := unary ( joinop ['[' cond ']'] unary )*
 *   unary   := σ '[' cond ']' unary
 *            | π '[' attr (',' attr)* ']' unary
 *            | ρ '[' Name ['(' a, b, ... ')'] ']' unary
 *            | '(' expr ')'
 *            | RelationName
 *   cond    := andCond ( (∨|or) andCond )*
 *   andCond := notCond ( (∧|and) notCond )*
 *   notCond := (¬|not) notCond | '(' cond ')' | operand cmp operand
 *
 * ASCII alternatives: select/sigma, project/pi, rename/rho, join, leftjoin, rightjoin,
 * fulljoin, cross/times, and, or, not, <=, >=, !=, <>.
 */

export class ParseError extends Error {
  constructor(message: string, public pos: number) {
    super(message);
  }
}

type TokType = 'ident' | 'num' | 'str' | 'sym' | 'eof';
interface Token {
  type: TokType;
  value: string;
  pos: number;
}

const WORD_SYMBOLS: Record<string, string> = {
  select: 'σ', sigma: 'σ',
  project: 'π', pi: 'π',
  rename: 'ρ', rho: 'ρ',
  join: '⋈', natjoin: '⋈',
  leftjoin: '⟕', ljoin: '⟕',
  rightjoin: '⟖', rjoin: '⟖',
  fulljoin: '⟗', fjoin: '⟗', outerjoin: '⟗',
  cross: '×', times: '×',
  and: '∧', or: '∨', not: '¬',
};

const SINGLE = new Set(['σ', 'π', 'ρ', '⋈', '⟕', '⟖', '⟗', '×', '∧', '∨', '¬', '(', ')', '[', ']', ',', '.', '=', '<', '>', '≠', '≤', '≥', '{', '}']);
const QUOTES: Record<string, string> = { "'": "'", '"': '"', '‘': '’', '“': '”', '”': '”', '’': '’' };

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    const start = i;
    if (/[A-Za-z]/.test(ch)) {
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      const word = src.slice(start, i);
      const sym = WORD_SYMBOLS[word.toLowerCase()];
      toks.push(sym ? { type: 'sym', value: sym, pos: start } : { type: 'ident', value: word, pos: start });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      i++;
      while (i < src.length && /[0-9.]/.test(src[i])) i++;
      toks.push({ type: 'num', value: src.slice(start, i), pos: start });
      continue;
    }
    if (QUOTES[ch]) {
      // Straight and curly quotes are interchangeable (slides use ”Kubrick”); '' inside '…' escapes a quote.
      const closers = "'‘’".includes(ch) ? "'‘’" : '"“”';
      i++;
      let s = '';
      for (;;) {
        if (i >= src.length) throw new ParseError('Unterminated string literal', start);
        if (closers.includes(src[i])) {
          if (src[i] === src[i + 1]) { s += src[i]; i += 2; continue; }
          break;
        }
        s += src[i++];
      }
      i++;
      toks.push({ type: 'str', value: s, pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '!=', '<>', '=='].includes(two)) {
      toks.push({ type: 'sym', value: two === '<=' ? '≤' : two === '>=' ? '≥' : two === '==' ? '=' : '≠', pos: start });
      i += 2;
      continue;
    }
    if (ch === '*') { toks.push({ type: 'sym', value: '×', pos: start }); i++; continue; }
    if (ch === '&') { toks.push({ type: 'sym', value: '∧', pos: start }); i += src[i + 1] === '&' ? 2 : 1; continue; }
    if (ch === '|') { toks.push({ type: 'sym', value: '∨', pos: start }); i += src[i + 1] === '|' ? 2 : 1; continue; }
    if (ch === '_') { i++; continue; }
    if (ch === '!') { toks.push({ type: 'sym', value: '¬', pos: start }); i++; continue; }
    if (SINGLE.has(ch)) {
      // Allow {…} as an alias for […] (LaTeX-style subscripts such as σ_{year > 1970}).
      toks.push({ type: 'sym', value: ch === '{' ? '[' : ch === '}' ? ']' : ch, pos: start });
      i++;
      continue;
    }
    throw new ParseError(`Unexpected character "${ch}"`, start);
  }
  toks.push({ type: 'eof', value: '', pos: src.length });
  return toks;
}

const JOIN_SYMBOLS: Record<string, JoinOp> = { '×': 'product', '⋈': 'natural', '⟕': 'left', '⟖': 'right', '⟗': 'full' };
const CMP: Record<string, CmpOp> = { '=': '=', '≠': '!=', '<': '<', '≤': '<=', '>': '>', '≥': '>=' };

class Parser {
  private i = 0;
  constructor(private toks: Token[]) {}

  private peek(): Token { return this.toks[this.i]; }
  private next(): Token { return this.toks[this.i++]; }
  private isSym(v: string): boolean { const t = this.peek(); return t.type === 'sym' && t.value === v; }
  private expect(v: string, what?: string): Token {
    const t = this.peek();
    if (t.type === 'sym' && t.value === v) return this.next();
    throw new ParseError(`Expected ${what ?? `"${v}"`} but found ${describe(t)}`, t.pos);
  }
  private ident(what: string): Token {
    const t = this.peek();
    if (t.type === 'ident') return this.next();
    throw new ParseError(`Expected ${what} but found ${describe(t)}`, t.pos);
  }

  parseQuery(): Expr {
    const e = this.expr();
    const t = this.peek();
    if (t.type !== 'eof') throw new ParseError(`Unexpected ${describe(t)} — is an operator missing?`, t.pos);
    return e;
  }

  private expr(): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.type !== 'sym' || !(t.value in JOIN_SYMBOLS)) break;
      this.next();
      let op = JOIN_SYMBOLS[t.value];
      let cond: Cond | undefined;
      if (this.isSym('[')) {
        this.next();
        cond = this.cond();
        this.expect(']');
        if (op === 'natural') op = 'theta';
        if (op === 'product') throw new ParseError('× does not take a condition — use ⋈[condition] for a theta join', t.pos);
      }
      const right = this.unary();
      left = { kind: 'join', op, cond, left, right };
    }
    return left;
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.type === 'sym' && t.value === 'σ') {
      this.next();
      this.expect('[', '"[" after σ (write σ[condition](Relation))');
      const cond = this.cond();
      this.expect(']');
      return { kind: 'select', cond, child: this.unary() };
    }
    if (t.type === 'sym' && t.value === 'π') {
      this.next();
      this.expect('[', '"[" after π (write π[attr1, attr2](Relation))');
      const attrs: AttrRef[] = [this.attr()];
      while (this.isSym(',')) { this.next(); attrs.push(this.attr()); }
      this.expect(']');
      return { kind: 'project', attrs, child: this.unary() };
    }
    if (t.type === 'sym' && t.value === 'ρ') {
      this.next();
      this.expect('[', '"[" after ρ (write ρ[NewName](Relation))');
      const newName = this.ident('a new relation name').value;
      let attrs: string[] | undefined;
      if (this.isSym('(')) {
        this.next();
        attrs = [this.ident('an attribute name').value];
        while (this.isSym(',')) { this.next(); attrs.push(this.ident('an attribute name').value); }
        this.expect(')');
      }
      this.expect(']');
      return { kind: 'rename', newName, attrs, child: this.unary() };
    }
    if (t.type === 'sym' && t.value === '(') {
      this.next();
      const e = this.expr();
      this.expect(')', 'a closing ")"');
      return e;
    }
    if (t.type === 'ident') {
      this.next();
      return { kind: 'rel', name: t.value };
    }
    throw new ParseError(`Expected a relation name, "(", σ, π or ρ but found ${describe(t)}`, t.pos);
  }

  private attr(): AttrRef {
    const first = this.ident('an attribute name').value;
    if (this.isSym('.')) {
      this.next();
      return { rel: first, name: this.ident('an attribute name after "."').value };
    }
    return { name: first };
  }

  private cond(): Cond {
    let l = this.andCond();
    while (this.isSym('∨')) { this.next(); l = { kind: 'or', l, r: this.andCond() }; }
    return l;
  }
  private andCond(): Cond {
    let l = this.notCond();
    while (this.isSym('∧') || this.isSym(',')) { this.next(); l = { kind: 'and', l, r: this.notCond() }; }
    return l;
  }
  private notCond(): Cond {
    if (this.isSym('¬')) { this.next(); return { kind: 'not', e: this.notCond() }; }
    if (this.isSym('(')) {
      this.next();
      const c = this.cond();
      this.expect(')', 'a closing ")"');
      return c;
    }
    const l = this.operand();
    const t = this.peek();
    if (t.type !== 'sym' || !(t.value in CMP)) throw new ParseError(`Expected a comparison (=, ≠, <, ≤, >, ≥) but found ${describe(t)}`, t.pos);
    this.next();
    return { kind: 'cmp', op: CMP[t.value], l, r: this.operand() };
  }
  private operand(): Operand {
    const t = this.peek();
    if (t.type === 'num') { this.next(); return { kind: 'lit', value: Number(t.value) }; }
    if (t.type === 'str') { this.next(); return { kind: 'lit', value: t.value }; }
    if (t.type === 'ident') {
      if (t.value.toLowerCase() === 'null') { this.next(); return { kind: 'lit', value: null }; }
      return { kind: 'attr', ref: this.attr() };
    }
    throw new ParseError(`Expected an attribute, number or 'string' but found ${describe(t)}`, t.pos);
  }
}

function describe(t: Token): string {
  if (t.type === 'eof') return 'the end of the query';
  if (t.type === 'str') return `'${t.value}'`;
  return `"${t.value}"`;
}

export function parseQuery(src: string): Expr {
  if (!src.trim()) throw new ParseError('The query is empty', 0);
  return new Parser(tokenize(src)).parseQuery();
}

// ---------- Pretty printing ----------

const OP_SYMBOL: Record<JoinOp, string> = { product: '×', natural: '⋈', theta: '⋈', left: '⟕', right: '⟖', full: '⟗' };

export function fmtValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return `'${v}'`;
  return String(v);
}

export function attrToString(a: AttrRef): string {
  return a.rel ? `${a.rel}.${a.name}` : a.name;
}

export function condToString(c: Cond): string {
  switch (c.kind) {
    case 'cmp': {
      const op = { '=': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥' }[c.op];
      const side = (o: Operand) => (o.kind === 'attr' ? attrToString(o.ref) : fmtValue(o.value));
      return `${side(c.l)} ${op} ${side(c.r)}`;
    }
    case 'not': return `¬(${condToString(c.e)})`;
    case 'and': return `${wrapOr(c.l)} ∧ ${wrapOr(c.r)}`;
    case 'or': return `${condToString(c.l)} ∨ ${condToString(c.r)}`;
  }
}
function wrapOr(c: Cond): string { return c.kind === 'or' ? `(${condToString(c)})` : condToString(c); }

export function exprToString(e: Expr): string {
  switch (e.kind) {
    case 'rel': return e.name;
    case 'select': return `σ[${condToString(e.cond)}](${exprToString(e.child)})`;
    case 'project': return `π[${e.attrs.map(attrToString).join(', ')}](${exprToString(e.child)})`;
    case 'rename': return `ρ[${e.newName}${e.attrs ? `(${e.attrs.join(', ')})` : ''}](${exprToString(e.child)})`;
    case 'join': {
      const l = exprToString(e.left);
      const r = e.right.kind === 'join' ? `(${exprToString(e.right)})` : exprToString(e.right);
      const op = OP_SYMBOL[e.op] + (e.cond ? `[${condToString(e.cond)}]` : '');
      return `${l} ${op} ${r}`;
    }
  }
}
