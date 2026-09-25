import { Check } from 'lucide-react';
import { cn } from 'cn';
import type { PlayerApi } from '@/hooks/use-player';

/** One chip per operator (T1, T2, …). The active chip fills up as its step progresses. */
export function Pipeline({ player }: { player: PlayerApi }) {
  const { result, frame, runId } = player;
  if (!result || !result.stages.length) return <div id="pipeline" className="hidden" />;
  return (
    <div id="pipeline" className="pipeline flex flex-wrap items-center gap-2">
      {result.stages.map((s, si) => {
        const active = frame?.stage === si;
        const done = frame !== undefined && si < frame.stage;
        const progress = active && frame ? (frame.ev + 1) / (s.events.length + 1) : done ? 1 : 0;
        return (
          <span key={`${runId}:${si}`} className="contents">
            {si > 0 && <span className="arrow text-muted-foreground animate-in fade-in duration-500" style={{ animationDelay: `${si * 70}ms` }}>→</span>}
            <button type="button" data-stage={si} title={s.label} onClick={() => player.jumpToStage(si)}
              style={{ animationDelay: `${si * 70}ms` }}
              className={cn(
                'chip relative inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-full border bg-card px-2.5 py-1 font-mono text-[12.5px]',
                'animate-in fade-in slide-in-from-left-2 fill-mode-both duration-500 transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5',
                active && 'active border-primary bg-brand-soft shadow-[0_0_0_3px] shadow-primary/15',
                done && 'done border-match',
              )}>
              {/* progress fill */}
              <span aria-hidden className="absolute inset-y-0 left-0 bg-primary/10 transition-[width] duration-500 ease-(--ease-out)" style={{ width: `${progress * 100}%` }} />
              <span className="tname relative font-sans font-semibold text-muted-foreground">{s.output.name}</span>
              <span className="relative text-[15px] text-primary">{s.symbol}</span>
              <span className="relative truncate">{s.short}</span>
              {done && <Check className="relative size-3.5 text-match animate-in zoom-in-0 spin-in-45 duration-300" />}
            </button>
          </span>
        );
      })}
    </div>
  );
}
