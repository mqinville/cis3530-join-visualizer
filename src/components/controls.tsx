import { ChevronsRight, Pause, Play, SkipBack, StepBack, StepForward } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PlayerApi } from '@/hooks/use-player';

function Ctrl({ id, tip, onClick, children, className }: { id: string; tip: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button id={id} variant="outline" size="icon" aria-label={tip} onClick={onClick}
          className={cn('bg-card transition-transform hover:border-primary hover:text-primary active:scale-90', className)}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

export function Controls({ player }: { player: PlayerApi }) {
  const { playing, idx, lastIdx, speed } = player;
  return (
    <Card className="controls sticky top-2 z-10 flex-row flex-wrap items-center gap-4 px-3.5 py-2.5 shadow-(--shadow) backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="flex items-center gap-1.5">
        <Ctrl id="btn-first" tip="Restart (Home)" onClick={player.first}><SkipBack /></Ctrl>
        <Ctrl id="btn-prev" tip="Step back (←)" onClick={player.prev}><StepBack /></Ctrl>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button id="btn-play" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={player.toggle}
              className="relative w-11 transition-transform active:scale-90">
              {/* Both icons stay mounted and cross-fade with a little rotation. */}
              <Play className={cn('absolute transition-all duration-300 ease-(--ease-spring)', playing ? 'scale-50 -rotate-90 opacity-0' : 'scale-100 opacity-100')} />
              <Pause className={cn('absolute transition-all duration-300 ease-(--ease-spring)', playing ? 'scale-100 opacity-100' : 'scale-50 rotate-90 opacity-0')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Play / pause (Space)</TooltipContent>
        </Tooltip>
        <Ctrl id="btn-next" tip="Step forward (→)" onClick={player.next}><StepForward /></Ctrl>
        <Ctrl id="btn-stage" tip="Finish this step" onClick={player.finishStage}><ChevronsRight /></Ctrl>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button id="btn-last" variant="outline" size="sm" onClick={player.last} className="bg-card hover:border-primary hover:text-primary">Final result</Button>
          </TooltipTrigger>
          <TooltipContent>Jump to the final result (End)</TooltipContent>
        </Tooltip>
      </div>
      <Slider id="scrub" aria-label="Timeline" className="min-w-36 flex-1 [&_[data-slot=slider-range]]:transition-[right] [&_[data-slot=slider-range]]:duration-300 [&_[data-slot=slider-thumb]]:transition-[left] [&_[data-slot=slider-thumb]]:duration-300"
        min={0} max={lastIdx} step={1} value={[idx]} onValueChange={([v]) => player.seek(v)} />
      <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        Speed
        <Slider id="speed" aria-label="Speed" className="w-24" min={0.25} max={4} step={0.25} value={[speed]} onValueChange={([v]) => player.setSpeed(v)} />
        <span id="speed-val" className="w-9 tabular-nums">{speed}×</span>
      </label>
    </Card>
  );
}
