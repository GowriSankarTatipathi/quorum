import { approvalRepository, type ApprovalRecord } from '@quorum/db';
import type { TrustLevel } from '@quorum/core';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { createRedis } from '../redis.js';
import { eventPublisher } from './event-publisher.js';

export const approvalKey = (runId: string, approvalId: string): string =>
  `run:${runId}:approval:${approvalId}`;

export interface ApprovalDecision {
  decision: 'APPROVED' | 'REJECTED';
  userId: string;
  editedPayload: Record<string, unknown> | null;
  scope: 'SINGLE' | 'SIMILAR_IN_RUN';
}

export class ApprovalTimeoutError extends Error {
  constructor(readonly approvalId: string) {
    super(`Approval ${approvalId} was not answered in time`);
    this.name = 'ApprovalTimeoutError';
  }
}

export interface RequestApprovalInput {
  runId: string;
  stepId: string;
  correlationId: string;
  trustLevel: TrustLevel;
  action: Record<string, unknown>;
  payload: Record<string, unknown> | null;
  screenshotKey: string | null;
  reason: string;
}

/**
 * Block a run until a human decides.
 *
 * The wait is a Redis `BLPOP`, not a poll. Polling burns CPU and adds latency proportional
 * to the interval, whereas a blocked pop wakes in single-digit milliseconds and costs
 * nothing while waiting — and since an approval can legitimately sit for minutes while
 * someone reads, "costs nothing while waiting" is the entire requirement.
 *
 * A dedicated connection is used because a client blocked in BLPOP cannot serve other
 * commands, and the run still needs to publish events while it waits.
 */
export async function awaitApproval(input: RequestApprovalInput): Promise<ApprovalDecision> {
  // Consent granted earlier in this run for the same trust level short-circuits the wait.
  // Scoped to the run, never global: blanket permissions are how approval systems die.
  if (await approvalRepository.hasRunScopedConsent(input.runId, input.trustLevel)) {
    return {
      decision: 'APPROVED',
      userId: 'run-scoped-consent',
      editedPayload: null,
      scope: 'SIMILAR_IN_RUN',
    };
  }

  const approval: ApprovalRecord = await approvalRepository.request({
    stepId: input.stepId,
    trustLevel: input.trustLevel,
    action: input.action,
    payload: input.payload,
    screenshotKey: input.screenshotKey,
    reason: input.reason,
  });

  await eventPublisher.emit(
    'approval.requested',
    {
      approvalId: approval.id,
      trustLevel: input.trustLevel,
      reason: input.reason,
      action: input.action,
      payload: input.payload,
      screenshotKey: input.screenshotKey,
    },
    {
      runId: input.runId,
      agent: 'human',
      stepId: input.stepId,
      correlationId: input.correlationId,
    },
  );

  const blocking = createRedis('approval-barrier');
  const startedAt = Date.now();
  try {
    const raw = await blocking.blpop(approvalKey(input.runId, approval.id), env.APPROVAL_TIMEOUT_S);

    if (!raw) {
      await approvalRepository.timeout(approval.id);
      await eventPublisher.emit(
        'approval.timeout',
        { approvalId: approval.id, waitedMs: Date.now() - startedAt },
        { runId: input.runId, agent: 'human', stepId: input.stepId },
      );
      // A timeout is not a rejection — the person went for coffee. The caller parks the
      // run rather than destroying three minutes of browser work.
      throw new ApprovalTimeoutError(approval.id);
    }

    const decision = JSON.parse(raw[1]) as ApprovalDecision;
    logger.info(
      { runId: input.runId, approvalId: approval.id, decision: decision.decision },
      'approval decided',
    );
    return decision;
  } finally {
    await blocking.quit().catch(() => undefined);
  }
}
