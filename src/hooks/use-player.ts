import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EvalResult } from '@/engine/types';
import { buildFrames, frameDelay } from '@/lib/frames';

interface Position {
  idx: number;
  /** True when we arrived by stepping forward (play / next), which is when rows fly into the result. */
  animate: boolean;
  /** Bumps on every move so identical positions still re-trigger effects (e.g. restart). */
  tick: number;
}

export function usePlayer() {
  const [result, setResult] = useState<EvalResult | null>(null);
  const [pos, setPos] = useState<Position>({ idx: 0, animate: false, tick: 0 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [runId, setRunId] = useState(0);

  const frames = useMemo(() => (result ? buildFrames(result) : []), [result]);
  const lastIdx = Math.max(0, frames.length - 1);

  const show = useCallback((idx: number, animate: boolean) => {
    setPos((p) => ({ idx, animate, tick: p.tick + 1 }));
  }, []);

  const load = useCallback((r: EvalResult, autoplay: boolean) => {
    setResult(r);
    setRunId((n) => n + 1);
    setPos((p) => ({ idx: 0, animate: false, tick: p.tick + 1 }));
    setPlaying(autoplay && r.stages.length > 0);
  }, []);

  const pause = useCallback(() => setPlaying(false), []);

  const play = useCallback(() => {
    if (!frames.length) return;
    if (pos.idx >= lastIdx) show(0, false);
    setPlaying(true);
  }, [frames.length, pos.idx, lastIdx, show]);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, pause, play]);
  const next = useCallback(() => { pause(); if (pos.idx < lastIdx) show(pos.idx + 1, true); }, [pause, pos.idx, lastIdx, show]);
  const prev = useCallback(() => { pause(); if (pos.idx > 0) show(pos.idx - 1, false); }, [pause, pos.idx, show]);
  const first = useCallback(() => { pause(); show(0, false); }, [pause, show]);
  const last = useCallback(() => { pause(); show(lastIdx, false); }, [pause, lastIdx, show]);
  const seek = useCallback((idx: number) => { pause(); show(Math.max(0, Math.min(idx, lastIdx)), false); }, [pause, lastIdx, show]);

  const finishStage = useCallback(() => {
    pause();
    const s = frames[pos.idx]?.stage;
    let j = pos.idx;
    while (j + 1 < frames.length && frames[j + 1].stage === s) j++;
    // Already at the end of this step? Move to the end of the next one.
    if (j === pos.idx && j + 1 < frames.length) {
      j++;
      const s2 = frames[j].stage;
      while (j + 1 < frames.length && frames[j + 1].stage === s2) j++;
    }
    show(j, false);
  }, [pause, frames, pos.idx, show]);

  const jumpToStage = useCallback((si: number) => {
    pause();
    const j = frames.findIndex((f) => f.stage === si);
    if (j >= 0) show(j, false);
  }, [pause, frames, show]);

  // The playback clock: each frame schedules the next one, with a per-event delay.
  useEffect(() => {
    if (!playing || !result || !frames.length) return;
    const t = window.setTimeout(() => {
      if (pos.idx >= lastIdx) { setPlaying(false); return; }
      show(pos.idx + 1, true);
    }, frameDelay(result, frames[pos.idx], speed));
    return () => window.clearTimeout(t);
  }, [playing, result, frames, pos.idx, lastIdx, speed, show]);

  return {
    result, runId, frames, frame: frames[pos.idx], idx: pos.idx, lastIdx, animate: pos.animate, tick: pos.tick,
    playing, speed, setSpeed, load, play, pause, toggle, next, prev, first, last, seek, finishStage, jumpToStage,
  };
}

export type PlayerApi = ReturnType<typeof usePlayer>;
