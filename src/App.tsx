import { useCallback, useEffect, useRef, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { buildDatabase } from '@/engine/data';
import { evaluate, EvalError } from '@/engine/evaluator';
import { ParseError, parseQuery } from '@/engine/parser';
import { PRESETS } from '@/engine/presets';
import type { Expr } from '@/engine/types';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BaseTables } from '@/components/base-tables';
import { Controls } from '@/components/controls';
import { Pipeline } from '@/components/pipeline';
import { CUSTOM, QueryPanel, type QueryError } from '@/components/query-panel';
import { StageView } from '@/components/stage-view';
import { usePlayer } from '@/hooks/use-player';

function relationsIn(e: Expr, acc = new Set<string>()): Set<string> {
  if (e.kind === 'rel') acc.add(e.name.toLowerCase());
  else if (e.kind === 'join') { relationsIn(e.left, acc); relationsIn(e.right, acc); }
  else relationsIn(e.child, acc);
  return acc;
}

function toError(err: unknown, query: string): QueryError {
  if (err instanceof ParseError) {
    const before = query.slice(0, err.pos).split('\n');
    return { kind: 'syntax', message: err.message, line: query.split('\n')[before.length - 1], caret: before[before.length - 1].length };
  }
  if (err instanceof EvalError) return { kind: 'plain', message: err.message };
  return { kind: 'plain', message: `Unexpected error: ${(err as Error).message}` };
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
  const toggle = () => setDark((d) => {
    try { localStorage.setItem('ra-theme', d ? 'light' : 'dark'); } catch { /* storage unavailable */ }
    return !d;
  });
  return { dark, toggle };
}

export function App() {
  const player = usePlayer();
  const { dark, toggle: toggleTheme } = useTheme();
  const [presetId, setPresetId] = useState(PRESETS[0].id);
  const [lastPresetId, setLastPresetId] = useState(PRESETS[0].id);
  const [query, setQuery] = useState('');
  const [bachchan, setBachchan] = useState(false);
  const [error, setError] = useState<QueryError | null>(null);
  const [errorKey, setErrorKey] = useState(0);
  const [used, setUsed] = useState<Set<string>>(new Set());

  const run = useCallback((q: string, b: boolean, sel: string, autoplay: boolean) => {
    setError(null);
    try {
      const ast = parseQuery(q);
      const result = evaluate(ast, buildDatabase(b));
      setUsed(relationsIn(ast));
      player.load(result, autoplay);
      const params = new URLSearchParams();
      if (sel !== CUSTOM) params.set('p', sel);
      else { params.set('q', q); params.set('b', b ? '1' : '0'); }
      history.replaceState(null, '', `#${params.toString()}`);
    } catch (err) {
      setError(toError(err, q));
      setErrorKey((k) => k + 1);
      setUsed(new Set());
    }
  }, [player.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPreset = (id: string, autoplay: boolean) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(p.id);
    setLastPresetId(p.id);
    setQuery(p.query);
    setBachchan(p.bachchan);
    run(p.query, p.bachchan, p.id, autoplay);
  };

  const onQuery = (q: string) => {
    setQuery(q);
    const p = PRESETS.find((x) => x.id === lastPresetId);
    setPresetId(!p || q.trim() !== p.query ? CUSTOM : lastPresetId);
  };

  // Initial load from the shareable URL hash.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const params = new URLSearchParams(location.hash.slice(1));
    const p = params.get('p'), q = params.get('q');
    if (q) {
      const b = params.get('b') === '1';
      setQuery(q); setBachchan(b); setPresetId(CUSTOM);
      run(q, b, CUSTOM, false);
    } else {
      applyPreset(p && PRESETS.some((x) => x.id === p) ? p : PRESETS[0].id, false);
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard transport. Skipped while typing or while a widget that owns the arrow keys has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('textarea, input, select, [role=combobox], [role=listbox], [role=slider], [role=checkbox]')) return;
      if (e.key === ' ') { e.preventDefault(); player.toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); player.next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); player.prev(); }
      else if (e.key === 'Home') player.first();
      else if (e.key === 'End') player.last();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [player]);

  return (
    <TooltipProvider delayDuration={400}>
      <header className="topbar flex items-center justify-between border-b bg-card px-6 py-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-[28px] text-primary">⋈</span>
          <div>
            <h1 className="text-[17px] font-semibold">Relational algebra join visualizer</h1>
            <p className="text-[13px] text-muted-foreground">CIS3530 · Week 2 examples · watch every row get compared, matched, padded or dropped</p>
          </div>
        </div>
        <Button id="theme" variant="outline" size="icon" aria-label="Toggle light / dark" onClick={toggleTheme} className="relative overflow-hidden bg-card">
          <Sun className={`absolute transition-all duration-500 ease-(--ease-spring) ${dark ? 'translate-y-6 rotate-90 opacity-0' : ''}`} />
          <Moon className={`absolute transition-all duration-500 ease-(--ease-spring) ${dark ? '' : '-translate-y-6 -rotate-90 opacity-0'}`} />
        </Button>
      </header>

      <main className="layout mx-auto grid max-w-[1600px] grid-cols-1 gap-5 p-4 pb-10 min-[1000px]:grid-cols-[360px_minmax(0,1fr)] min-[1000px]:px-6 min-[1000px]:pt-5">
        <aside className="sidebar flex min-w-0 flex-col gap-4">
          <QueryPanel presetId={presetId} query={query} bachchan={bachchan} error={error} errorKey={errorKey}
            onPreset={(id) => applyPreset(id, true)}
            onQuery={onQuery}
            onBachchan={(b) => { setBachchan(b); run(query, b, presetId, false); }}
            onRun={() => run(query, bachchan, presetId, true)}
            onReset={() => applyPreset(presetId === CUSTOM ? lastPresetId : presetId, false)} />
          <BaseTables bachchan={bachchan} used={used} />
        </aside>

        <section className="workspace flex min-w-0 flex-col gap-4">
          <Pipeline player={player} />
          <Controls player={player} />
          <StageView player={player} />
        </section>
      </main>
    </TooltipProvider>
  );
}
