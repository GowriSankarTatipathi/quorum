import { Queue } from 'bullmq';
import { redis } from '../redis.js';

/** Must match `QUEUE_NAMES` in the worker; a typo here would enqueue into a queue no
 *  worker consumes, and the run would sit at CREATED forever with no error anywhere. */
export const RUN_QUEUE_NAME = 'quorum.run';
export const EXPORT_QUEUE_NAME = 'quorum.export';

export const runQueue = new Queue(RUN_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: { age: 604_800 },
  },
});

/**
 * The run id doubles as the job id, which makes enqueueing idempotent: a retried request
 * cannot start a second planning job for the same run.
 *
 * The separator is a hyphen, not a colon: BullMQ rejects custom job ids containing `:`
 * because it uses that character to namespace its own Redis keys. Every enqueue in this
 * file used to throw for that reason.
 */
export async function enqueueRunPlan(runId: string): Promise<void> {
  await runQueue.add('run.plan', { runId }, { jobId: `plan-${runId}` });
}

/** Enqueued after plan approval, and again on resume. The job id is per-attempt so a
 *  resumed run is a new job rather than a duplicate of a completed one. */
export async function enqueueRunExecute(runId: string): Promise<void> {
  await runQueue.add('run.execute', { runId }, { jobId: `exec-${runId}-${String(Date.now())}` });
}

export const exportQueue = new Queue(EXPORT_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    removeOnComplete: { age: 3_600 },
    removeOnFail: { age: 86_400 },
  },
});

export async function enqueueExport(
  runId: string,
  format: string,
  requestedBy: string,
): Promise<void> {
  // One job per run and format at a time: re-requesting the same export should replace the
  // pending one rather than queue a second identical workbook build.
  await exportQueue.add(
    'run.export',
    { runId, format, requestedBy },
    { jobId: `export-${runId}-${format}` },
  );
}

export async function closeQueue(): Promise<void> {
  await Promise.allSettled([runQueue.close(), exportQueue.close()]);
}
