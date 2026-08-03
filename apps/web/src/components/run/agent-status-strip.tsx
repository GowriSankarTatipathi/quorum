'use client';

import { AGENT_LABELS, type AgentId } from '@quorum/core';
import { cn } from '@quorum/ui';
import { useRunStore } from '@/stores/run-store';

const ORDER: AgentId[] = [
  'planner',
  'browser',
  'reasoning',
  'verification',
  'critic',
  'recovery',
  'formatter',
];

const DOT: Record<string, string> = {
  idle: 'bg-[var(--color-hairline)]',
  running: 'bg-[var(--color-action)] animate-[pulse-live_2s_ease-in-out_infinite]',
  done: 'bg-[var(--color-verified)]',
  failed: 'bg-[var(--color-failed)]',
};

/**
 * All seven agents, always visible.
 *
 * The cheapest way to communicate "this is a system, not a prompt" — the architecture is
 * legible at a glance rather than something the user has to be told about.
 */
export function AgentStatusStrip() {
  const agents = useRunStore((state) => state.agents);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Agent status">
      {ORDER.map((agent) => (
        <span key={agent} className="flex items-center gap-1.5 text-xs">
          <span aria-hidden className={cn('size-1.5 rounded-full', DOT[agents[agent]])} />
          <span
            className={cn(
              'transition-colors',
              agents[agent] === 'idle' ? 'text-fg-subtle' : 'text-fg-muted',
            )}
          >
            {AGENT_LABELS[agent]}
          </span>
          <span className="sr-only">{agents[agent]}</span>
        </span>
      ))}
    </div>
  );
}
