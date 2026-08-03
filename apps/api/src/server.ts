import { disconnect as disconnectDb } from '@quorum/db';
import { buildApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { closeRedis } from './redis.js';

async function main(): Promise<void> {
  const app = await buildApp();

  /**
   * Graceful shutdown. Fly sends SIGTERM and waits before SIGKILL; draining in-flight
   * requests and closing pools in order is what makes a rolling deploy zero-downtime
   * rather than a burst of 502s.
   */
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    void (async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'shutting down');
      try {
        await app.close();
        await closeRedis();
        await disconnectDb();
        logger.info('shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'error during shutdown');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(
    { port: env.PORT, docs: `http://localhost:${env.PORT}/docs` },
    'quorum api listening',
  );
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'failed to start api');
  process.exit(1);
});
