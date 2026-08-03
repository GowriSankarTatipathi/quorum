import { env } from './env.js';
import { logger } from './logger.js';
import { publisher } from './redis.js';

export const HEARTBEAT_KEY = 'quorum:workers';

export interface WorkerHeartbeat {
  workerId: string;
  pid: number;
  startedAt: string;
  lastSeenAt: string;
  activeSessions: number;
  maxSessions: number;
  driver: string;
}

/**
 * Workers scale to zero, so "no worker is running" is a normal state rather than an
 * outage. The API cannot infer capacity from its own process, so each worker publishes
 * a TTL'd heartbeat: the gateway reads the set to report honest queue ETAs, and an
 * evicted machine's entry expires on its own with no cleanup path to get wrong.
 */
export class Heartbeat {
  private timer: NodeJS.Timeout | null = null;
  private readonly workerId = process.env.FLY_MACHINE_ID ?? `local-${process.pid}`;
  private readonly startedAt = new Date().toISOString();
  private activeSessions = 0;

  setActiveSessions(count: number): void {
    this.activeSessions = count;
  }

  private async publish(): Promise<void> {
    const payload: WorkerHeartbeat = {
      workerId: this.workerId,
      pid: process.pid,
      startedAt: this.startedAt,
      lastSeenAt: new Date().toISOString(),
      activeSessions: this.activeSessions,
      maxSessions: env.MAX_CONCURRENT_SESSIONS,
      driver: env.BROWSER_DRIVER,
    };
    // TTL is 3x the interval, so one missed tick from GC pressure is not a false alarm.
    const ttlSeconds = Math.ceil((env.WORKER_HEARTBEAT_MS * 3) / 1000);
    await publisher.hset(HEARTBEAT_KEY, this.workerId, JSON.stringify(payload));
    await publisher.set(`${HEARTBEAT_KEY}:${this.workerId}:alive`, '1', 'EX', ttlSeconds);
  }

  start(): void {
    if (this.timer) return;
    void this.publish().catch((error: unknown) =>
      logger.error({ err: error }, 'heartbeat publish failed'),
    );
    this.timer = setInterval(() => {
      void this.publish().catch((error: unknown) =>
        logger.error({ err: error }, 'heartbeat publish failed'),
      );
    }, env.WORKER_HEARTBEAT_MS);
    this.timer.unref();
    logger.info(
      { workerId: this.workerId, intervalMs: env.WORKER_HEARTBEAT_MS },
      'heartbeat started',
    );
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await publisher.hdel(HEARTBEAT_KEY, this.workerId);
    await publisher.del(`${HEARTBEAT_KEY}:${this.workerId}:alive`);
  }
}

export const heartbeat = new Heartbeat();
