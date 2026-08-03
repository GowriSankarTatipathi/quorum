'use client';

import { Button } from '@quorum/ui';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { formatEventTime } from '@/lib/format';
import { useRunStore, type StreamEvent } from '@/stores/run-store';

/** Playback speeds a person actually wants: real time, brisk, and skim. */
const SPEEDS = [1, 4, 16] as const;

/**
 * Replay.
 *
 * It is not a separate rendering of history — it feeds the same reducer the live stream
 * feeds, in order, with a delay. That is the payoff for making the interface a projection
 * of the event log: replay was almost free, and because it runs the identical code path it
 * cannot drift from what the run actually looked like. A replay you cannot trust is not an
 * audit trail.
 */
export function TimelineScrubber({ events }: { events: StreamEvent[] }) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(4);
  const timer = useRef<number | null>(null);
  const applied = useRef(0);

  const startedAt = events[0]?.ts ?? null;

  // Rewinding cannot un-apply events, so it replays from the beginning into a fresh store.
  useEffect(() => {
    const store = useRunStore.getState();
    if (cursor < applied.current) {
      store.reset(store.runId ?? '');
      applied.current = 0;
    }
    if (cursor > applied.current) {
      store.applyBatch(events.slice(applied.current, cursor));
      applied.current = cursor;
    }
  }, [cursor, events]);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= events.length) {
      setPlaying(false);
      return;
    }

    const current = events[cursor];
    const next = events[cursor + 1];
    const gapMs =
      current && next ? new Date(next.ts).getTime() - new Date(current.ts).getTime() : 200;
    // Long pauses (a human deciding on an approval) are compressed: watching a replay sit
    // still for four minutes teaches nothing.
    const delay = Math.min(Math.max(gapMs, 40), 1_500) / speed;

    timer.current = window.setTimeout(() => {
      setCursor((value) => value + 1);
    }, delay);

    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [playing, cursor, events, speed]);

  const current = events[Math.max(0, cursor - 1)];

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-hairline px-4 py-2.5">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setPlaying((value) => !value);
        }}
        aria-label={playing ? 'Pause replay' : 'Play replay'}
      >
        {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        {playing ? 'Pause' : 'Play'}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setPlaying(false);
          setCursor(0);
        }}
        aria-label="Restart replay"
      >
        <RotateCcw aria-hidden />
      </Button>

      <label className="flex items-center gap-2 text-xs text-fg-subtle">
        <span className="sr-only">Replay position</span>
        <input
          type="range"
          min={0}
          max={events.length}
          value={cursor}
          onChange={(e) => {
            setPlaying(false);
            setCursor(Number(e.target.value));
          }}
          className="w-64 accent-[var(--color-action)]"
        />
      </label>

      <span className="font-mono text-[11px] tabular-nums text-fg-subtle">
        {cursor}/{events.length}
        {current && ` · ${formatEventTime(current.ts, startedAt)}`}
      </span>

      <div className="ml-auto flex items-center gap-1">
        {SPEEDS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setSpeed(value);
            }}
            aria-pressed={speed === value}
            className={`rounded-[var(--radius-control)] px-2 py-0.5 font-mono text-[11px] transition-colors ${
              speed === value ? 'bg-overlay text-fg' : 'text-fg-subtle hover:text-fg-muted'
            }`}
          >
            {value}×
          </button>
        ))}
      </div>
    </div>
  );
}
