import { useRef, useState } from 'react';
import { ChevronRight, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { cn } from 'cn';
import { PRESETS } from '@/engine/presets';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export const CUSTOM = '__custom';

export type QueryError = { kind: 'syntax'; message: string; line: string; caret: number } | { kind: 'plain'; message: string };

const SYMBOLS: [string, string, number][] = [
  // [label, inserted text, caret offset from the start of the insertion]
  ['σ', 'σ[]()', 2], ['π', 'π[]()', 2], ['ρ', 'ρ[]()', 2],
  ['×', ' × ', 3], ['⋈', ' ⋈ ', 3], ['⋈θ', ' ⋈[] ', 3], ['⟕', ' ⟕ ', 3], ['⟖', ' ⟖ ', 3], ['⟗', ' ⟗ ', 3],
  ['∧', ' ∧ ', 3], ['∨', ' ∨ ', 3], ['¬', '¬', 1], ['≠', ' ≠ ', 3], ['≤', ' ≤ ', 3], ['≥', ' ≥ ', 3],
];

const HELP: [string, React.ReactNode][] = [
  ['σ[cond](R)', <>select rows · <code>select[...]</code></>],
  ['π[a, b](R)', <>project columns · <code>project[...]</code></>],
  ['ρ[N](R)', <>rename · <code>rename[...]</code></>],
  ['R × S', <>Cartesian product · <code>cross</code></>],
  ['R ⋈ S', <>natural join · <code>join</code></>],
  ['R ⋈[cond] S', <>theta join · <code>join[...]</code></>],
  ['R ⟕ S', <>left outer join · <code>leftjoin</code></>],
  ['R ⟖ S', <>right outer join · <code>rightjoin</code></>],
  ['R ⟗ S', <>full outer join · <code>fulljoin</code></>],
  ['∧ ∨ ¬', <code>and or not</code>],
  ['= ≠ < ≤ > ≥', <><code>!= &lt;= &gt;=</code> also work</>],
];

interface Props {
  presetId: string;
  query: string;
  bachchan: boolean;
  error: QueryError | null;
  errorKey: number;
  onPreset: (id: string) => void;
  onQuery: (q: string) => void;
  onBachchan: (b: boolean) => void;
  onRun: () => void;
  onReset: () => void;
}

export function QueryPanel({ presetId, query, bachchan, error, errorKey, onPreset, onQuery, onBachchan, onRun, onReset }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const preset = PRESETS.find((p) => p.id === presetId);

  const insert = (text: string, caret: number) => {
    const el = ta.current!;
    const s = el.selectionStart, e = el.selectionEnd;
    const next = query.slice(0, s) + text + query.slice(e);
    onQuery(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + caret; });
  };

  return (
    <Card className="gap-0 py-4 shadow-(--shadow)">
      <CardHeader className="px-4">
        <CardTitle className="text-[13px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Query</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <Label htmlFor="preset" className="mt-2.5 mb-1.5 text-xs font-normal text-muted-foreground">Example from the slides</Label>
        <Select value={presetId} onValueChange={(v) => v !== CUSTOM && onPreset(v)}>
          <SelectTrigger id="preset" className="w-full bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-96">
            {PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id} data-preset={p.id}>
                <span className="text-muted-foreground">{p.slide} ·</span> {p.title}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={CUSTOM} data-preset={CUSTOM} disabled={presetId !== CUSTOM}>Custom query (edited)</SelectItem>
          </SelectContent>
        </Select>

        <p key={presetId} id="question" className="mt-2 rounded-r-md border-l-[3px] border-primary bg-brand-soft px-2.5 py-2 text-[13px] animate-in fade-in slide-in-from-left-1 duration-300">
          <span className="block text-xs text-muted-foreground">{preset ? preset.slide : 'Your own query'}</span>
          {preset ? preset.question : 'Edit the expression and press Run (⌘/Ctrl + Enter).'}
        </p>

        <Label htmlFor="query" className="mt-3 mb-1.5 text-xs font-normal text-muted-foreground">Relational algebra expression</Label>
        <Textarea id="query" ref={ta} rows={4} spellCheck={false} autoComplete="off" value={query}
          className="min-h-24 bg-card font-mono text-[13.5px] leading-relaxed"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onRun(); } }} />
        <div className="mt-1.5 flex flex-wrap gap-1" aria-label="Insert symbol">
          {SYMBOLS.map(([label, text, caret]) => (
            <Button key={label} type="button" variant="outline" size="sm" title={`Insert ${label}`}
              className="h-7.5 min-w-7.5 px-1.5 text-[15px] font-normal hover:-translate-y-0.5 hover:border-primary hover:text-primary active:translate-y-0 active:scale-95"
              onClick={() => insert(text, caret)}>{label}</Button>
          ))}
        </div>

        <div className="mt-3.5 flex items-start gap-2">
          <Checkbox id="bachchan" checked={bachchan} onCheckedChange={(c) => onBachchan(c === true)} className="mt-0.5" />
          <Label htmlFor="bachchan" className="text-[13px] leading-snug font-normal">Include artist 5, Bachchan (added on slide 44)</Label>
        </div>

        <div className="mt-3.5 flex flex-wrap gap-2">
          <Button id="run" onClick={onRun} className="group font-semibold">
            <Play className="transition-transform group-hover:scale-110" />Run &amp; animate
          </Button>
          <Button id="reset" variant="outline" onClick={onReset} className="group">
            <RotateCcw className="transition-transform duration-500 group-hover:-rotate-180" />Reset to slide query
          </Button>
        </div>

        {error && (
          <Alert key={errorKey} id="error" variant="destructive" className="mt-3 border-nomatch/40 bg-nomatch-soft animate-in fade-in slide-in-from-top-1 duration-300 [&>svg]:animate-[row-shake_0.4s]">
            <TriangleAlert />
            <AlertDescription className="text-[13px] whitespace-pre-wrap text-nomatch">
              {error.kind === 'syntax' ? `Syntax error: ${error.message}` : error.message}
              {error.kind === 'syntax' && (
                <pre className="mt-1.5 overflow-x-auto font-mono text-[12.5px] text-foreground">{`${error.line}\n${' '.repeat(error.caret)}^`}</pre>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Collapsible open={helpOpen} onOpenChange={setHelpOpen} className="mt-3 text-[13px]">
          <CollapsibleTrigger className="flex items-center gap-1 text-primary hover:underline">
            <ChevronRight className={cn('size-4 transition-transform duration-300', helpOpen && 'rotate-90')} />Syntax help
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            <table className="my-2 w-full border-collapse">
              <tbody>
                {HELP.map(([sym, desc]) => (
                  <tr key={sym}><td className="border-b px-1 py-0.75 align-top"><code>{sym}</code></td><td className="border-b px-1 py-0.75 align-top">{desc}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1.5 text-muted-foreground">
              Strings go in quotes: <code>director = 'Kubrick'</code>. Use <code>Movies.mID</code> when a name appears in both tables.
              σ, π, ρ bind tighter than joins (slide 50), and joins go left to right.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
