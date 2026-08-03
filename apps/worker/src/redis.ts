import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connection: its blocking
 * commands legitimately wait for minutes, and ioredis's default retry ceiling would
 * abort them and drop jobs.
 */
export function createRedis(role: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  client.on('error', (error: Error) => logger.error({ err: error, role }, 'redis error'));
  return client;
}

export const connection: Redis = createRedis('bullmq');
/** Separate connection for publishing events: a subscriber-mode client cannot publish. */
export const publisher: Redis = createRedis('publisher');

export async function checkRedis(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await connection.ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([connection.quit(), publisher.quit()]);
}
