import { DEFAULT_SESSION_OPTIONS } from '@quorum/browser';
import { BudgetGovernor, createBlackboard } from '@quorum/core';
import { critiqueRepository, runRepository, stepRepository, type RunRecord } from '@quorum/db';
import type { Job } from 'bullmq';
import { executeStep } from '../agents/step-executor.js';
import { runCriticAgent } from '../agents/critic.js';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { browserDriver, sessionPool } from '../services/browser.js';
import { eventPublisher, newCorrelation } from '../services/event-publisher.js';

export interface ExecuteJobData {
  runId: string;
}

const governor = new BudgetGovernor();

/**
 * The execution phase of a run.
 *
 * Entered only after a human has approved the plan. It opens one browser session, walks
 * the steps, then hands every claim to the Critic — which is the only component with a
 * view across all of them, and therefore the only one that can catch a set of
 * individually-correct values that cannot be compared with each other.
 */
export async function processRunExecute(job: Job<ExecuteJobData>): Promise<void> {
  const { runId } = job.data;
  await eventPublisher.resume(runId);

  const run = await runRepository.findById(runId);
  if (!run) {
    logger.warn({ runId }, 'run disappeared before execution');
    return;
  }
  if (run.status !== 'AWAITING_APPROVAL' && run.status !== 'PAUSED') {
    logger.info({ runId, status: run.status }, 'run is not ready to execute; skipping');
    return;
  }
  if (!run.planHash) {
    logger.warn({ runId }, 'run has no approved plan');
    return;
  }

  const steps = await stepRepository.listForRun(runId);
  const board = createBlackboard({
    runId,
    orgId: run.orgId,
    goal: run.goal,
    mode: run.mode,
    budgetMicroUsd: run.budgetMicroUsd,
    wallClockLimitMs: env.MAX_RUN_DURATION_MS,
    startedAtMs: Date.now(),
  });
  board.stepCount = steps.length;
  board.allowedHosts = allowedHostsFrom(steps.map((step) => step.targetUrl));

  await setStatus(runId, run.status, 'EXECUTING');

  const session = await sessionPool.acquire({
    ...DEFAULT_SESSION_OPTIONS,
    runId,
    allowedHosts: board.allowedHosts,
    respectRobotsTxt: env.RESPECT_ROBOTS_TXT,
  });
  await runRepository.attachSession(runId, session.id, session.liveViewUrl);
  await eventPublisher.emit(
    'browser.session.opened',
    { sessionId: session.id, driver: browserDriver.kind, liveViewUrl: session.liveViewUrl },
    { runId, agent: 'browser' },
  );

  const sessionStartedAt = Date.now();
  try {
    for (const step of steps) {
      if (step.status === 'DONE' || step.status === 'SKIPPED') continue;
      sessionPool.touch(session.id);

      const current = await runRepository.findById(runId);
      // Re-read rather than trusting the in-memory copy: a control action may have
      // arrived from the API since the last step, and honouring stop late is not honouring
      // it at all.
      if (!current || current.status === 'CANCELLED') {
        logger.info({ runId }, 'run cancelled between steps');
        return;
      }

      const spent = current.spentMicroUsd;
      const verdict = governor.check({ ...board.budget, spentMicroUsd: spent }, board.startedAtMs);
      if (!verdict.allow) {
        await parkForBudget(runId, board.budget.limitMicroUsd, spent, step.index, steps.length);
        return;
      }
      if (verdict.warn === 'approaching_limit') {
        await eventPublisher.emit(
          'budget.warning',
          { spentUsd: spent / 1_000_000, limitUsd: board.budget.limitMicroUsd / 1_000_000 },
          { runId },
        );
      }

      const outcome = await executeStep(step, {
        runId,
        orgId: run.orgId,
        mode: run.mode,
        allowedHosts: board.allowedHosts,
        session,
        budgetRemainingUsd: () => governor.remainingUsd({ ...board.budget, spentMicroUsd: spent }),
      });

      if (outcome.kind === 'paused') {
        await setStatus(runId, 'EXECUTING', 'PAUSED');
        return;
      }
      if (outcome.kind === 'needs_human') {
        await setStatus(runId, 'EXECUTING', 'TAKEOVER');
        await eventPublisher.emit(
          'human.takeover.started',
          { by: 'system', reason: outcome.question },
          { runId, agent: 'human', stepId: step.id },
        );
        return;
      }
    }

    await setStatus(runId, 'EXECUTING', 'CRITIQUE');
    const critiques = await runCriticAgent({
      runId,
      correlationId: newCorrelation(),
      goal: run.goal,
      expectedEntityCount: board.allowedHosts.length > 0 ? board.allowedHosts.length : null,
    });

    // A blocking finding means the result is wrong if unaddressed, so the run does not
    // present itself as finished while one is open.
    const blocked = await critiqueRepository.hasUnresolvedBlocking(runId);
    const finalStatus = blocked ? 'PAUSED' : 'COMPLETED';
    await setStatus(runId, 'CRITIQUE', finalStatus);

    if (!blocked) {
      const verified = await countVerified(runId);
      await eventPublisher.emit(
        'run.completed',
        {
          claimCount: verified.total,
          verifiedCount: verified.verified,
          costUsd: (await currentSpend(runId)) / 1_000_000,
          durationMs: Date.now() - sessionStartedAt,
        },
        { runId },
      );
    }

    logger.info({ runId, critiques: critiques.length, blocked }, 'run execution finished');
  } finally {
    await sessionPool.release(session.id);
    await eventPublisher.emit(
      'browser.session.closed',
      { sessionId: session.id, durationMs: Date.now() - sessionStartedAt },
      { runId, agent: 'browser' },
    );
    eventPublisher.release(runId);
  }
}

async function setStatus(
  runId: string,
  from: RunRecord['status'],
  to: RunRecord['status'],
): Promise<void> {
  await runRepository.setStatus(runId, to);
  await eventPublisher.emit('run.status.changed', { from, to }, { runId });
}

async function parkForBudget(
  runId: string,
  limitMicroUsd: number,
  spentMicroUsd: number,
  completedSteps: number,
  totalSteps: number,
): Promise<void> {
  await setStatus(runId, 'EXECUTING', 'PAUSED');
  await eventPublisher.emit(
    'budget.exceeded',
    { spentUsd: spentMicroUsd / 1_000_000, limitUsd: limitMicroUsd / 1_000_000 },
    { runId },
  );
  logger.info(
    {
      runId,
      question: governor.describeOverrun(
        { limitMicroUsd, spentMicroUsd, wallClockLimitMs: 0, raisedByHuman: false },
        completedSteps,
        totalSteps,
      ),
    },
    'run parked at budget limit',
  );
}

async function currentSpend(runId: string): Promise<number> {
  return (await runRepository.findById(runId))?.spentMicroUsd ?? 0;
}

async function countVerified(runId: string): Promise<{ total: number; verified: number }> {
  const { claimRepository } = await import('@quorum/db');
  return claimRepository.verifiedRate(runId);
}

/** Hosts the plan declared. Enforced by the driver, not only by the model. */
function allowedHostsFrom(urls: readonly (string | null)[]): string[] {
  const hosts = new Set<string>();
  for (const url of urls) {
    if (!url) continue;
    try {
      hosts.add(new URL(url).hostname.replace(/^www\./, '').toLowerCase());
    } catch {
      // A malformed target URL was already rejected by the plan schema; skipping here
      // keeps a bad row from widening the allowlist.
    }
  }
  return [...hosts];
}
