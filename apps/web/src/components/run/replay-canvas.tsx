'use client';

import { useEffect } from 'react';
import { useRunStore, type StreamEvent } from '@/stores/run-store';
import { AgentStatusStrip } from './agent-status-strip';
import { AgentStream } from './agent-stream';
import { BrowserViewport } from './browser-viewport';
import { ClaimsTable } from './claims-table';
import { EventLog } from './event-log';
import { TimelineScrubber } from './timeline-scrubber';

/**
 * The same canvas, driven by history instead of a socket.
 *
 * Every panel is unchanged — they read the store, and the store does not know whether an
 * event arrived over a WebSocket a second ago or out of Postgres from six weeks ago.
 */
export function ReplayCanvas({
  runId,
  goal,
  events,
}: {
  runId: string;
  goal: string;
  events: StreamEvent[];
}) {
  useEffect(() => {
    useRunStore.getState().reset(runId);
  }, [runId]);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-5 py-2.5">
        <span className="rounded border border-[var(--color-action)]/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-action)]">
          replay
        </span>
        <p className="truncate text-sm" title={goal}>
          {goal}
        </p>
        <span className="ml-auto font-mono text-[11px] text-fg-subtle">{events.length} events</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[55%_45%]">
        <div className="flex min-h-0 flex-col border-r border-hairline">
          <div className="min-h-0 flex-1 overflow-auto">
            <AgentStream />
          </div>
          <div className="h-48 shrink-0">
            <EventLog />
          </div>
        </div>
        <div className="flex min-h-0 flex-col gap-3 p-3">
          <div className="min-h-0 flex-1">
            <BrowserViewport />
          </div>
          <div className="max-h-[45%] min-h-0 overflow-hidden rounded-[var(--radius-panel)] border border-hairline">
            <ClaimsTable />
          </div>
          <div className="shrink-0 px-1">
            <AgentStatusStrip />
          </div>
        </div>
      </div>

      <TimelineScrubber events={events} />
    </div>
  );
}
