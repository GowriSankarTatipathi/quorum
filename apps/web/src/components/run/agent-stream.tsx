'use client';

import { AGENT_LABELS } from '@quorum/core';
import { cn } from '@quorum/ui';
import { Check, ChevronDown, Loader2, Workflow, X } from 'lucide-react';
import { useState } from 'react';
import { formatUsd } from '@/lib/format';
import { useRunStore, type AgentTurn } from '@/stores/run-store';
import { EmptyState, SkeletonRows } from './empty-state';

/**
 * Agent turns as cards, not a chat log.
 *
 * A two-hundred-message chat is unreadable by minute two. Completed turns collapse to one
 * line, so the screen holds a constant, scannable density no matter how long the run gets.
 * Reasoning is available but closed by default: power users want it, and defaulting it open
 * is how a transparency feature becomes noise.
 */
export function AgentStream() {
  const turns = useRunStore((state) => state.turns);

  const status = useRunStore((state) => state.status);

  if (turns.length === 0) {
    // Planning has a known shape and a short, predictable wait, so a skeleton is honest
    // here. Before that there is nothing to promise, so we say what will happen instead.
    return status === 'PLANNING' ? (
      <SkeletonRows rows={4} />
    ) : (
      <EmptyState
        icon={<Workflow className="size-4" aria-hidden />}
        title="No agent has started yet"
        detail="Each agent's turn appears here as it happens — what it decided, what it did, and what it cost."
      />
    );
  }

  return (
    <ol className="divide-y divide-[var(--color-hairline)]">
      {turns.map((turn, index) => (
        <TurnCard
          key={`${turn.correlationId}-${String(index)}`}
          turn={turn}
          isLast={index === turns.length - 1}
        />
      ))}
    </ol>
  );
}

function TurnCard({ turn, isLast }: { turn: AgentTurn; isLast: boolean }) {
  const live = turn.finishedAt === null;
  const [open, setOpen] = useState(false);
  const showReasoning = open || (live && turn.reasoning.length > 0);

  return (
    <li className="relative animate-[stream-in_150ms_cubic-bezier(0.2,0,0,1)] px-4 py-3">
      {/* Connects one agent's turn to the next, so a handoff reads as a single flow
          rather than as an unrelated list of cards. */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[1.30rem] top-8 w-px bg-[var(--color-hairline)]"
        />
      )}
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            'relative z-10 flex size-4 items-center justify-center rounded-full border text-[9px]',
            live
              ? 'border-[var(--color-action)] bg-base text-[var(--color-action)]'
              : turn.failed
                ? 'border-[var(--color-failed)] bg-base text-failed'
                : 'border-[var(--color-hairline)] bg-base text-fg-subtle',
          )}
        >
          ⬡
        </span>
        <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
          {AGENT_LABELS[turn.agent]}
        </span>
        {turn.stepIndex !== null && (
          <span className="font-mono text-[11px] text-fg-subtle">
            step {String(turn.stepIndex + 1).padStart(2, '0')}
          </span>
        )}

        <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-fg-subtle">
          {turn.failed ? (
            <X className="size-3 text-failed" aria-hidden />
          ) : live ? (
            <Loader2 className="size-3 animate-spin text-[var(--color-action)]" aria-hidden />
          ) : (
            <Check className="size-3 text-verified" aria-hidden />
          )}
          {turn.durationMs !== null && <span>{(turn.durationMs / 1000).toFixed(2)}s</span>}
          {turn.reasoning.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setOpen((value) => !value);
              }}
              aria-expanded={showReasoning}
              className="flex items-center gap-0.5 rounded px-1 hover:text-fg-muted"
            >
              reasoning
              <ChevronDown
                aria-hidden
                className={cn('size-3 transition-transform', showReasoning && 'rotate-180')}
              />
            </button>
          )}
        </span>
      </div>

      {turn.actions.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-[var(--radius-control)] border border-hairline px-2.5 py-1.5">
          {turn.actions.map((action, i) => (
            <li
              key={`${action.type}-${String(i)}`}
              className="flex items-center gap-2 font-mono text-[11px]"
            >
              <span className="text-fg-subtle">▸</span>
              <span className="text-fg-muted">{action.type}</span>
              <span className="ml-auto text-fg-subtle">
                {action.ok ? (
                  <Check className="inline size-3 text-verified" aria-hidden />
                ) : (
                  <Loader2 className="inline size-3 animate-spin" aria-hidden />
                )}
                {action.durationMs !== null && ` ${String(action.durationMs)}ms`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {showReasoning && (
        <div className="mt-2 border-l border-[var(--color-hairline)] pl-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-fg-muted">
            {turn.reasoning}
            {live && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-fg-subtle align-middle" />
            )}
          </p>
          {turn.model && (
            // The honesty tax: every turn shows what it cost and which model produced it.
            <p className="mt-1.5 font-mono text-[10px] text-fg-subtle">
              {turn.model} · {formatUsd(turn.costUsd)}
            </p>
          )}
        </div>
      )}

      {isLast && live && <span className="sr-only">in progress</span>}
    </li>
  );
}
