import { Queue, type JobsOptions } from 'bullmq';
import { connection } from './redis.js';

/** Queue names are constants so a typo cannot silently create an orphan queue that
 *  accepts jobs no worker consumes. */
export const QUEUE_NAMES = {
  run: 'quorum.run',
  export: 'quorum.export',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Retries are jittered-exponential and bounded. Completed jobs are trimmed but failures
 * are retained far longer: a failed run is the thing an engineer actually needs to
 * inspect, and the successful ones are already reconstructible from the event log.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400 * 7 },
};

export const runQueue = new Queue(QUEUE_NAMES.run, {
  connection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export const exportQueue = new Queue(QUEUE_NAMES.export, {
  connection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([runQueue.close(), exportQueue.close()]);
}
