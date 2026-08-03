import { runRepository } from '@quorum/db';
import type { Job } from 'bullmq';
import { PlannerRefusedError, runPlanner } from '../agents/planner.js';
import { logger } from '../logger.js';
import { eventPublisher } from '../services/event-publisher.js';

export interface RunJobData {
  runId: string;
}

/**
 * The plan phase of a run.
 *
 * It ends in AWAITING_APPROVAL rather than continuing into execution — deliberately. The
 * plan is a document the human reads and edits before a single browser starts, and the
 * job returning here is what makes that gate real rather than advisory.
 */
export async function processRunPlan(job: Job<RunJobData>): Promise<void> {
  const { runId } = job.data;

  // Continues the event sequence if this run was already partly processed by a worker
  // that was evicted; restarting the sequence would invalidate every client cursor.
  await eventPublisher.resume(runId);

  const run = await runRepository.findById(runId);
  if (!run) {
    logger.warn({ runId }, 'run disappeared before planning; nothing to do');
    return;
  }
  if (run.status !== 'CREATED' && run.status !== 'PLANNING') {
    logger.info({ runId, status: run.status }, 'run is past planning; skipping');
    return;
  }

  await runRepository.setStatus(runId, 'PLANNING');
  await eventPublisher.emit(
    'run.status.changed',
    { from: run.status, to: 'PLANNING' },
    { runId, agent: 'planner' },
  );

  try {
    const result = await runPlanner({
      runId,
      orgId: run.orgId,
      goal: run.goal,
      mode: run.mode,
      budgetMicroUsd: run.budgetMicroUsd,
      recipeId: run.recipeId,
    });

    await runRepository.setStatus(runId, 'AWAITING_APPROVAL');
    await eventPublisher.emit(
      'run.status.changed',
      { from: 'PLANNING', to: 'AWAITING_APPROVAL' },
      { runId, agent: 'planner' },
    );

    await job.updateProgress({ phase: 'planned', steps: result.stepCount });
  } catch (error) {
    // A refusal is a correct outcome, not a crash: the Planner decided the goal cannot
    // be achieved by browsing public pages. Saying so in seconds beats discovering it
    // mid-run at the user's expense, so it is reported plainly and not retried.
    if (error instanceof PlannerRefusedError) {
      await runRepository.fail(runId, 'E_PLAN_REFUSED', { refusal: error.refusal });
      await eventPublisher.emit(
        'run.failed',
        { code: 'E_PLAN_REFUSED', humanMessage: error.refusal },
        { runId, agent: 'planner' },
      );
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, runId }, 'planning failed');
    await runRepository.fail(runId, 'E_PLAN_FAILED', { message });
    await eventPublisher.emit(
      'run.failed',
      {
        code: 'E_PLAN_FAILED',
        humanMessage:
          'I could not draw up a plan for that goal. Try rephrasing it, or naming the sites to visit.',
      },
      { runId, agent: 'planner' },
    );
    throw error;
  } finally {
    eventPublisher.release(runId);
  }
}
