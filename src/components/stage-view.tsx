import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { cn } from 'cn';
import type { Relation, Stage, StepEvent } from '@/engine/types';
import { Card } from '@/components/ui/card';
import { computeState, inputRowState, narrate } from '@/lib/frames';
import type { PlayerApi } from '@/hooks/use-player';
import { RelationTable, statsText } from './relation-table';

const SVG = 'http://www.w3.org/2000/svg';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Keep a row visible inside its scroll container (without scrolling the page). */
function ensureVisible(container: HTMLElement, row: HTMLElement, smooth: boolean): void {
  const headH = container.querySelector('thead')?.getBoundingClientRect().height ?? 0;
  const top = row.offsetTop;
  const bottom = top + row.offsetHeight;
  let to: number | null = null;
  if (top - headH < container.scrollTop) to = top - headH;
  else if (bottom > container.scrollTop + container.clientHeight) to = bottom - container.clientHeight;
  if (to !== null) container.scrollTo({ top: to, behavior: smooth && !reducedMotion() ? 'smooth' : 'instant' });
}

export function StageView({ player }: { player: PlayerApi }) {
  const { result, frame, runId, animate, tick, speed, playing } = player;
  const stage = result && frame ? result.stages[frame.stage] : undefined;
  if (!result) return null;
  if (!stage || !frame) return <BareRelation rel={result.result} />;
  return <ActiveStage key={`${runId}:${frame.stage}`} stage={stage} ev={frame.ev} player={player}
    stepKey={`${runId}:${tick}`} animate={animate} speed={speed} playing={playing} />;
}

function StageHead({ symbol, title, tooltip, summary }: { symbol: string; title: string; tooltip?: string; summary: string }) {
  return (
    <div className="mb-4 flex items-start gap-3.5">
      <span id="stage-symbol" className="grid size-12 flex-none place-items-center rounded-xl bg-brand-soft text-[26px] text-primary animate-in zoom-in-50 spin-in-12 duration-500 ease-(--ease-spring)">{symbol}</span>
      <div className="min-w-0">
        <h2 id="stage-title" title={tooltip} className="font-mono text-base font-semibold break-words">{title}</h2>
        <p id="stage-summary" className="mt-1 text-muted-foreground">{summary}</p>
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  '': 'border-border bg-muted',
  ok: 'border-match bg-match-soft',
  bad: 'border-nomatch bg-nomatch-soft',
  pad: 'border-pad bg-pad-soft',
  final: 'border-primary bg-brand-soft',
};

function NarrationBox({ counter, text, tone, stepKey }: { counter: string; text: string; tone: string; stepKey: string }) {
  return (
    <div id="narration" className={cn('narration my-4 min-h-12 rounded-xl border px-3.5 py-3 text-sm transition-colors duration-300', tone, TONE[tone])}>
      <span key={`c${stepKey}`} className="swap-in block text-xs text-muted-foreground">{counter}</span>
      <span key={`t${stepKey}`} className="swap-in block [animation-delay:40ms]">{text}</span>
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [
    ['bg-match-soft border-match', 'match / kept'],
    ['bg-nomatch-soft border-nomatch', 'no match / dropped'],
    ['bg-pad-soft border-pad', 'dangling row kept by outer join'],
    ['bg-null-soft border-null', 'null padding'],
    ['bg-key-soft border-input', 'attribute being compared'],
  ];
  return (
    <div className="mt-3.5 flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map(([sw, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5"><i className={cn('inline-block size-3 rounded-[3px] border', sw)} />{label}</span>
      ))}
    </div>
  );
}

function OutputHead({ title, stats }: { title: string; stats: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <h3 id="output-title" className="text-[13.5px] font-semibold">{title}</h3>
      <span id="output-stats" className="text-[11.5px] whitespace-nowrap text-muted-foreground">{stats}</span>
    </div>
  );
}

function BareRelation({ rel }: { rel: Relation }) {
  return (
    <Card id="stage" className="stage gap-0 p-4 shadow-(--shadow) animate-in fade-in slide-in-from-bottom-2 duration-500">
      <StageHead symbol="▦" title={rel.name}
        summary="This query is just a table name, so there is no operation to animate. Try joining it with another table." />
      <div id="inputs" className="inputs relative"><svg id="links" className="links" aria-hidden="true" /></div>
      <NarrationBox counter="" text={`Result: ${rel.rows.length} tuple(s).`} tone="final" stepKey="bare" />
      <OutputHead title={`Result: ${rel.name}`} stats={statsText(rel)} />
      <RelationTable rel={rel} className="tall" />
      <Legend />
    </Card>
  );
}

interface ActiveProps {
  stage: Stage;
  ev: number;
  player: PlayerApi;
  stepKey: string;
  animate: boolean;
  speed: number;
  playing: boolean;
}

function ActiveStage({ stage: s, ev, player, stepKey, animate, speed, playing }: ActiveProps) {
  const result = player.result!;
  const st = useMemo(() => computeState(s, ev), [s, ev]);
  const narration = narrate(result, player.frame!, st);
  const isJoin = s.inputs.length === 2;

  const inputsRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const scrollRefs = useRef<(HTMLDivElement | null)[]>([]);
  const linkKey = useRef('');

  // Rows revealed by a jump (not by stepping forward) cascade in; remember what was visible last frame.
  const prevVisible = useRef(0);
  const flight = Math.min(750, 800 / speed);
  const flies = animate && flight >= 120 && !reducedMotion();

  const outRowClass = (i: number) => cn(
    st.paddedOut.has(i) && 'padded',
    animate && i === st.newestOut && 'row-enter',
    !animate && i >= prevVisible.current && 'row-cascade',
  );

  const phasePreview = st.cur?.t === 'phase';
  const inRowClass = (k: number) => (i: number) => {
    const { cls } = inputRowState(s, st, k, i);
    if (phasePreview && cls.includes('dangling')) cls.push('preview');
    return cls.join(' ');
  };

  const drawLinks = useCallback((allowDraw: boolean) => {
    const svg = svgRef.current, box = inputsRef.current;
    if (!svg || !box) return;
    const e = st.cur;
    const [ls, rs] = scrollRefs.current;
    if (!e || e.t !== 'pair' || !ls || !rs) { svg.replaceChildren(); linkKey.current = ''; return; }
    const lRow = ls.querySelector<HTMLElement>(`tbody tr[data-i="${e.l}"]`);
    const rRow = rs.querySelector<HTMLElement>(`tbody tr[data-i="${e.r}"]`);
    if (!lRow || !rRow) return;
    const bx = box.getBoundingClientRect();
    const a = lRow.getBoundingClientRect(), b = rRow.getBoundingClientRect();
    const la = ls.getBoundingClientRect(), rb = rs.getBoundingClientRect();
    const clampY = (y: number, r: DOMRect) => Math.max(r.top + 4, Math.min(r.bottom - 4, y));
    // Stacked layout (narrow screens): connect the bottom of left to the top of right.
    const sideBySide = rb.left >= la.right - 1;
    let x1: number, y1: number, x2: number, y2: number, d: string, mx: number, my: number;
    if (sideBySide) {
      x1 = la.right - bx.left; y1 = clampY(a.top + a.height / 2, la) - bx.top;
      x2 = rb.left - bx.left; y2 = clampY(b.top + b.height / 2, rb) - bx.top;
      const dx = (x2 - x1) / 2;
      d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      mx = (x1 + x2) / 2; my = (y1 + y2) / 2;
    } else {
      x1 = a.left + 30 - bx.left; y1 = la.bottom - bx.top;
      x2 = b.left + 30 - bx.left; y2 = rb.top - bx.top;
      d = `M${x1},${y1} L${x2},${y2}`;
      mx = x1 + 18; my = (y1 + y2) / 2;
    }
    // Same comparison as last time (e.g. a scroll): just move the existing line, don't redraw it.
    let g = svg.firstElementChild as SVGGElement | null;
    if (!g || linkKey.current !== stepKey) {
      linkKey.current = stepKey;
      g = document.createElementNS(SVG, 'g');
      g.setAttribute('class', cn(e.match ? 'ok' : 'bad', allowDraw && 'draw'));
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('pathLength', '1');
      const c1 = document.createElementNS(SVG, 'circle'), c2 = document.createElementNS(SVG, 'circle');
      [c1, c2].forEach((c) => { c.setAttribute('class', 'end'); c.setAttribute('r', '4'); });
      const badge = document.createElementNS(SVG, 'g');
      badge.setAttribute('class', 'badge');
      const bc = document.createElementNS(SVG, 'circle');
      bc.setAttribute('r', '11');
      const txt = document.createElementNS(SVG, 'text');
      txt.textContent = e.match ? '✓' : '✗';
      badge.append(bc, txt);
      g.append(path, c1, c2, badge);
      svg.replaceChildren(g);
    }
    const [path, c1, c2, badge] = Array.from(g.children) as SVGElement[];
    path.setAttribute('d', d);
    c1.setAttribute('cx', String(x1)); c1.setAttribute('cy', String(y1));
    c2.setAttribute('cx', String(x2)); c2.setAttribute('cy', String(y2));
    const [bc, txt] = Array.from(badge.children) as SVGElement[];
    bc.setAttribute('cx', String(mx)); bc.setAttribute('cy', String(my));
    txt.setAttribute('x', String(mx)); txt.setAttribute('y', String(my));
  }, [st.cur, stepKey]);

  // After every frame: scroll the rows in play into view, draw the connector, launch flying rows.
  useLayoutEffect(() => {
    const smooth = playing || animate;
    scrollRefs.current.forEach((scroll) => {
      const cur = scroll?.querySelector<HTMLElement>('tbody tr.cur');
      if (scroll && cur) ensureVisible(scroll, cur, smooth);
    });
    const out = outputRef.current;
    const rows = out?.querySelectorAll<HTMLTableRowElement>('tbody tr');
    const focus = st.newestOut !== undefined ? out?.querySelector<HTMLElement>(`tbody tr[data-i="${st.newestOut}"]`) : rows?.[rows.length - 1];
    if (out && focus) ensureVisible(out, focus, smooth);
    prevVisible.current = st.visibleOut;

    drawLinks(true);
    const ghosts = flies && st.cur && st.newestOut !== undefined && out
      ? flyGhosts(s, st.cur, out.querySelector<HTMLTableRowElement>(`tbody tr[data-i="${st.newestOut}"]`), scrollRefs.current, flight)
      : [];
    return () => ghosts.forEach((g) => g.remove()); // moving on cancels rows still in flight
  }, [stepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the connector attached to its rows while tables scroll or the window resizes.
  useEffect(() => {
    const redraw = () => drawLinks(false);
    const scrolls = scrollRefs.current.filter(Boolean) as HTMLElement[];
    scrolls.forEach((sc) => sc.addEventListener('scroll', redraw, { passive: true }));
    window.addEventListener('resize', redraw);
    return () => {
      scrolls.forEach((sc) => sc.removeEventListener('scroll', redraw));
      window.removeEventListener('resize', redraw);
    };
  }, [drawLinks]);

  const keyOut = isJoin && ['natural', 'left', 'right', 'full'].includes(s.kind) ? s.highlight[0] : [];
  const partial = st.visibleOut < s.output.rows.length;

  return (
    <Card id="stage" className="stage stage-enter gap-0 p-4 shadow-(--shadow) animate-in fade-in slide-in-from-bottom-3 duration-500 ease-(--ease-out)">
      <StageHead symbol={s.symbol} title={`${s.output.name} := ${s.short}`} tooltip={s.label} summary={s.summary} />

      <div id="inputs" ref={inputsRef} className={cn('inputs relative grid gap-12', isJoin ? 'grid-cols-[repeat(auto-fit,minmax(260px,1fr))]' : 'single grid-cols-1')}>
        <svg id="links" ref={svgRef} className="links" aria-hidden="true" />
        {s.inputs.map((rel, k) => {
          const dimCols = s.kind === 'project' ? rel.columns.map((_, i) => i).filter((i) => !s.highlight[0].includes(i)) : [];
          return (
            <div key={k} className={cn('input-table min-w-0 animate-in fade-in duration-500', k === 0 ? 'slide-in-from-left-4' : 'slide-in-from-right-4')}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="text-[13.5px] font-semibold">{rel.name}{isJoin ? (k === 0 ? ' (left)' : ' (right)') : ''}</h3>
                <span className="text-[11.5px] whitespace-nowrap text-muted-foreground">{statsText(rel)}</span>
              </div>
              <RelationTable ref={(n) => { scrollRefs.current[k] = n; }} rel={rel} keyCols={s.highlight[k]} dimCols={dimCols} rowClass={inRowClass(k)} />
            </div>
          );
        })}
      </div>

      <NarrationBox {...narration} stepKey={stepKey} />

      <div className="output">
        <OutputHead title={`Result ${s.output.name}`} stats={
          <>degree {s.output.columns.length} · cardinality <span key={st.visibleOut} className={cn(animate && 'tick-pop')}>{st.visibleOut}</span>{partial ? ' so far' : ''}</>
        } />
        <RelationTable ref={outputRef} rel={s.output} limit={st.visibleOut} rowClass={outRowClass}
          leftCount={isJoin ? s.inputs[0].columns.length : undefined} keyCols={keyOut} className="tall" />
      </div>
      <Legend />
    </Card>
  );
}

/**
 * Animate copies of the source row(s) flying into the new result row. They lift slightly, arc
 * down into place and shrink to the width of the cells they fill; the result row itself fades in
 * as they land (see tr.row-enter in globals.css).
 */
function flyGhosts(s: Stage, e: StepEvent, target: HTMLTableRowElement | null, scrolls: (HTMLElement | null)[], duration: number): HTMLElement[] {
  if (!target) return [];
  const cells = Array.from(target.querySelectorAll('td')).slice(1);
  target.style.setProperty('--land', `${Math.round(duration * 0.6)}ms`);
  const span = (from: number, to: number): DOMRect | null => {
    const cs = cells.slice(from, to);
    if (!cs.length) return null;
    const a = cs[0].getBoundingClientRect(), b = cs[cs.length - 1].getBoundingClientRect();
    return new DOMRect(a.left, a.top, b.right - a.left, a.height);
  };
  const leftCount = s.inputs.length === 2 ? s.inputs[0].columns.length : cells.length;
  const rowOf = (k: number, i: number) => scrolls[k]?.querySelector<HTMLElement>(`tbody tr[data-i="${i}"]`) ?? null;
  const flights: { row: HTMLElement; to: DOMRect | null; pad: boolean }[] = [];
  if (e.t === 'pair') {
    const l = rowOf(0, e.l), r = rowOf(1, e.r);
    if (l) flights.push({ row: l, to: span(0, leftCount), pad: false });
    if (r) flights.push({ row: r, to: span(leftCount, cells.length) ?? span(0, cells.length), pad: false });
  } else if (e.t === 'pad') {
    const r = rowOf(e.side === 'left' ? 0 : 1, e.row);
    if (r) flights.push({ row: r, to: e.side === 'left' ? span(0, leftCount) : span(0, cells.length), pad: true });
  } else if (e.t === 'filter' || e.t === 'project') {
    const r = rowOf(0, e.row);
    if (r) flights.push({ row: r, to: span(0, cells.length), pad: false });
  }

  const ghosts: HTMLElement[] = [];
  flights.forEach((fl, n) => {
    if (!fl.to) return;
    const from = fl.row.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = cn('ghost', fl.pad && 'pad');
    Array.from(fl.row.querySelectorAll('td')).slice(1).forEach((td) => {
      const sp = document.createElement('span');
      sp.textContent = td.textContent ?? '';
      ghost.append(sp);
    });
    Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, transformOrigin: '0 0' });
    document.body.append(ghost);
    ghosts.push(ghost);
    const dx = fl.to.left - from.left, dy = fl.to.top - from.top;
    const sx = fl.to.width / Math.max(1, from.width);
    const lift = Math.min(28, Math.abs(dy) * 0.12);
    ghost.animate(
      [
        { transform: 'translate(0,0) scale(1,1)', opacity: 0, offset: 0 },
        { transform: `translate(${dx * 0.1}px, ${-lift}px) scale(1.03,1.03)`, opacity: 1, offset: 0.18, easing: 'cubic-bezier(.5,0,.3,1)' },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, 1)`, opacity: 0.9, offset: 0.85 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, 1)`, opacity: 0, offset: 1 },
      ],
      { duration, delay: n * 60, easing: 'linear', fill: 'both' },
    ).onfinish = () => ghost.remove();
  });
  return ghosts;
}

