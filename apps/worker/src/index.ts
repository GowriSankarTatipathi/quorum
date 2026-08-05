import { checkDatabase, disconnect as disconnectDb } from '@quorum/db';
import { Worker, type Job } from 'bullmq';
import { env } from './env.js';
import { heartbeat } from './heartbeat.js';
import { logger } from './logger.js';
import { processExport, type ExportJobData } from './processors/export.processor.js';
import { processRunExecute, type ExecuteJobData } from './processors/execute.processor.js';
import { processRunPlan, type RunJobData } from './processors/run.processor.js';
import { QUEUE_NAMES, closeQueues } from './queues.js';
import { connection, checkRedis, closeRedis } from './redis.js';
import { sessionPool } from './services/browser.js';
import { hasLiveProvider, logLlmMode } from './services/llm.js';
import { loadLlmConfig } from '@quorum/ai';

/**
 * Worker bootstrap.
 *
 * The worker verifies its dependencies before announcing itself. A worker that joins
 * the pool and then fails every job it claims is worse than one that never joined:
 * BullMQ would hand it work, it would fail, and the retry would land on the same
 * broken machine.
 */
async function main(): Promise<void> {
  // Debug check: where are the stale config variables coming from?
  const suspiciousEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.startsWith('OPENAI_') || k.startsWith('QUORUM_'))
  );
  if (Object.keys(suspiciousEnv).length > 0) {
    logger.warn({ suspiciousEnv }, 'Found suspicious environment variables at startup. These may be overriding the clean .env.local!');
  }

  logger.info(
    {
      driver: env.BROWSER_DRIVER,
      maxSessions: env.MAX_CONCURRENT_SESSIONS,
      budgetUsd: env.DEFAULT_RUN_BUDGET_USD,
      verificationSampleRate: env.VERIFICATION_SAMPLE_RATE,
      maxRecoveryAttempts: env.MAX_RECOVERY_ATTEMPTS_PER_RUN,
    },
    'quorum worker starting',
  );

  const [database, redisCheck] = await Promise.all([checkDatabase(), checkRedis()]);
  if (!database.ok) throw new Error('Database is unreachable; refusing to join the worker pool.');
  if (!redisCheck.ok) throw new Error('Redis is unreachable; refusing to join the worker pool.');
  logLlmMode();
  const llmConfig = loadLlmConfig();
  if (llmConfig.mode === 'live' && !hasLiveProvider()) {
    throw new Error(
      'No LLM provider key found. Export ANTHROPIC_API_KEY before starting the worker — a worker that claims jobs it cannot run is worse than one that never started. To exercise the pipeline without a vendor, use `pnpm e2e`.',
    );
  }
  
  logger.info(
    { 
      database, 
      redis: redisCheck,
      llm: {
        mode: llmConfig.mode,
        providers: [
          llmConfig.anthropic ? 'anthropic' : null,

        ].filter(Boolean),
        overrides: llmConfig.modelOverrides,
        provenance: llmConfig.provenance,
      }
    }, 
    'dependencies healthy'
  );

  heartbeat.start();

  /**
   * Concurrency is bounded by browser memory (~400 MB per Chromium context), not by CPU.
   * BullMQ enforces it per worker, so the process cannot claim more runs than the machine
   * can actually hold.
   */
  const runWorker = new Worker<RunJobData | ExecuteJobData>(
    QUEUE_NAMES.run,
    async (job) => {
      // One queue, two job names. Planning and execution have different lifetimes and
      // different failure semantics, but they belong to the same run and must not be
      // reordered relative to each other.
      if (job.name === 'run.execute') await processRunExecute(job as Job<ExecuteJobData>);
      else await processRunPlan(job as Job<RunJobData>);
    },
    {
      connection,
      concurrency: env.MAX_CONCURRENT_SESSIONS,
      // Execution holds a browser for minutes; a short lock would let a second worker
      // claim the same run and drive the same session.
      lockDuration: 300_000,
    },
  );

  const exportWorker = new Worker<ExportJobData>(QUEUE_NAMES.export, processExport, {
    connection,
    // Exports are CPU-bound workbook assembly, not browser work, so they scale on a
    // different axis and get their own consumer rather than competing for run slots.
    concurrency: 2,
    lockDuration: 120_000,
  });
  exportWorker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id, runId: job?.data.runId }, 'export job failed');
  });

  runWorker.on('failed', (job, error) => {
    logger.error({ err: error, jobId: job?.id, runId: job?.data.runId }, 'run job failed');
  });
  runWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, runId: job.data.runId }, 'run job completed');
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    void (async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'draining worker');
      try {
        await heartbeat.stop();
        // Stop claiming new jobs first, then let in-flight ones finish; closing the
        // queues first would orphan a run mid-plan.
        await runWorker.close();
        await exportWorker.close();
        await sessionPool.drain();
        await closeQueues();
        await closeRedis();
        await disconnectDb();
        logger.info('worker stopped cleanly');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'error during shutdown');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) =>
    logger.error({ err: reason }, 'unhandled rejection'),
  );

  logger.info('quorum worker ready');
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'failed to start worker');
  process.exit(1);
});
