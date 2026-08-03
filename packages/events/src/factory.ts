import { newEventId } from '@quorum/core';
import type { AgentId } from '@quorum/core';
import type { RunEvent, RunEventPayloads, RunEventType } from './types.js';

export interface EventContext {
  runId: string;
  agent?: AgentId | null;
  stepId?: string | null;
  causationId?: string | null;
  correlationId?: string | null;
}

/**
 * Per-run monotonic sequence numbers. The worker owns exactly one run at a time, so a
 * process-local counter is correct; it is rehydrated from the DB on resume so a
 * restarted run continues the sequence rather than restarting it (which would break
 * client cursors).
 */
export class SequenceCounter {
  private readonly counters = new Map<string, number>();

  seed(runId: string, lastSeq: number): void {
    this.counters.set(runId, lastSeq);
  }

  next(runId: string): number {
    const next = (this.counters.get(runId) ?? 0) + 1;
    this.counters.set(runId, next);
    return next;
  }

  release(runId: string): void {
    this.counters.delete(runId);
  }
}

export function createEvent<T extends RunEventType>(
  type: T,
  payload: RunEventPayloads[T],
  ctx: EventContext,
  seq: number,
): RunEvent<T> {
  return {
    id: newEventId(),
    runId: ctx.runId,
    seq,
    type,
    agent: ctx.agent ?? null,
    stepId: ctx.stepId ?? null,
    payload,
    causationId: ctx.causationId ?? null,
    correlationId: ctx.correlationId ?? null,
    ts: new Date().toISOString(),
  };
}

/** Redis pub/sub channel for a run's live event stream. */
export const runChannel = (runId: string): string => `run:${runId}:events`;
