'use client';

import { cn } from '@quorum/ui';
import { useEffect, useRef, useState } from 'react';
import { formatEventTime } from '@/lib/format';
import { useRunStore } from '@/stores/run-store';

const TYPE_COLOUR = (type: string): string => {
  if (type.endsWith('.failed') || type.startsWith('error.')) return 'text-failed';
  if (type.startsWith('security.')) return 'text-review';
  if (type.startsWith('claim.') || type.startsWith('approval.')) return 'text-verified';
  if (type.startsWith('human.')) return 'text-[var(--color-action)]';
  return 'text-fg-subtle';
};

/**
 * The terminal.
 *
 * Dense, monospaced, complete. It is the escape hatch for the technical user and the
 * debugging surface for us — every polished product needs one honest, ugly, total view of
 * what actually happened.
 */
export function EventLog() {
  const events = useRunStore((state) => state.events);
  const startedAt = useRunStore((state) => state.startedAt);
  const summaryMode = useRunStore((state) => state.summaryMode);
  const [pinned, setPinned] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [events.length, pinned]);

  return (
    <section aria-label="Event log" className="flex min-h-0 flex-col border-t border-hairline">
      <header className="flex items-center gap-2 px-3 py-1.5">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Event log</h2>
        {summaryMode && (
          <span className="rounded border border-[var(--color-review)]/40 px-1.5 py-0.5 text-[10px] text-review">
            condensed — slow connection
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-fg-subtle">{events.length}</span>
      </header>

      <div
        ref={scroller}
        // Auto-scroll only while already pinned to the bottom: never yank a reading user
        // back down because a new line arrived.
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
        }}
        className="min-h-0 flex-1 overflow-auto px-3 pb-2"
        aria-live="polite"
        aria-relevant="additions"
      >
        {events.map((event) => (
          <div key={event.id} className="flex gap-2 font-mono text-[11px] leading-relaxed">
            <span suppressHydrationWarning className="shrink-0 tabular-nums text-fg-subtle">
              {formatEventTime(event.ts, startedAt)}
            </span>
            <span className={cn('shrink-0', TYPE_COLOUR(event.type))}>{event.type}</span>
            <span className="truncate text-fg-subtle">{summarise(event.payload)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** One line per event. The full payload lives in the database; this is for scanning. */
function summarise(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const entries = Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => value !== null && typeof value !== 'object')
    .slice(0, 3)
    .map(([key, value]) => `${key}=${String(value)}`);
  return entries.join(' ');
}
