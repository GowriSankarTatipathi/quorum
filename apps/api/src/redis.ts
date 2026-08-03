import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Two connections by design. ioredis puts a client into subscriber mode when it
 * SUBSCRIBEs, after which it cannot issue ordinary commands — so the pub/sub relay
 * that feeds WebSocket clients must not share a connection with rate limiting.
 */
function create(role: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    // The gateway is on the request path, so a Redis outage must degrade it rather
    // than hang it. `enableOfflineQueue: false` makes commands fail immediately while
    // disconnected instead of queueing until the socket returns; combined with a
    // command timeout, a dead Redis costs milliseconds per request, not seconds.
    enableOfflineQueue: false,
    commandTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  client.on('error', (error: Error) => logger.error({ err: error, role }, 'redis error'));
  client.on('ready', () => logger.info({ role }, 'redis ready'));
  return client;
}

export const redis: Redis = create('commands');
export const redisSubscriber: Redis = create('subscriber');

export async function checkRedis(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await redis.ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisSubscriber.quit()]);
}
