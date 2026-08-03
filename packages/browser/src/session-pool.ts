import type { BrowserDriver, Session, SessionOptions } from './driver.js';

export interface SessionPoolOptions {
  /** Empirical: ~400 MB RSS per Chromium context, so four fit a 2 GB machine. */
  maxConcurrent: number;
  idleTimeoutMs: number;
  maxSessionMs: number;
  now?: () => number;
}

interface PooledSession {
  session: Session;
  acquiredAt: number;
  lastUsedAt: number;
}

export class SessionLimitReachedError extends Error {
  constructor(max: number) {
    super(`All ${String(max)} browser sessions on this worker are in use`);
    this.name = 'SessionLimitReachedError';
  }
}

/**
 * Bounds concurrent browser sessions per worker.
 *
 * Browser memory is the binding constraint on this system — not CPU, not the database,
 * not the model providers — so this is where the ceiling is enforced. Exceeding it does
 * not degrade gracefully: the machine OOMs and takes every in-flight run with it, which
 * is why acquisition refuses rather than queueing indefinitely.
 */
export class SessionPool {
  private readonly active = new Map<string, PooledSession>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly driver: BrowserDriver,
    private readonly options: SessionPoolOptions,
  ) {}

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  get size(): number {
    return this.active.size;
  }

  get hasCapacity(): boolean {
    return this.active.size < this.options.maxConcurrent;
  }

  async acquire(opts: SessionOptions): Promise<Session> {
    if (!this.hasCapacity) throw new SessionLimitReachedError(this.options.maxConcurrent);
    const session = await this.driver.createSession(opts);
    const now = this.now();
    this.active.set(session.id, { session, acquiredAt: now, lastUsedAt: now });
    return session;
  }

  touch(sessionId: string): void {
    const pooled = this.active.get(sessionId);
    if (pooled) pooled.lastUsedAt = this.now();
  }

  async release(sessionId: string): Promise<void> {
    if (!this.active.has(sessionId)) return;
    this.active.delete(sessionId);
    await this.driver.closeSession(sessionId);
  }

  /**
   * Reclaim sessions a crashed or hung run left behind.
   *
   * Without this, one wedged run permanently costs a quarter of the worker's capacity —
   * and because nothing errors, the machine simply gets quieter until it stops taking
   * work at all.
   */
  async sweep(): Promise<string[]> {
    const now = this.now();
    const reclaimed: string[] = [];
    for (const [id, pooled] of this.active) {
      const idle = now - pooled.lastUsedAt > this.options.idleTimeoutMs;
      const tooOld = now - pooled.acquiredAt > this.options.maxSessionMs;
      if (idle || tooOld) {
        reclaimed.push(id);
        await this.release(id);
      }
    }
    return reclaimed;
  }

  startSweeper(intervalMs = 30_000, onReclaim?: (ids: string[]) => void): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.sweep().then((ids) => {
        if (ids.length > 0) onReclaim?.(ids);
      });
    }, intervalMs);
    this.sweeper.unref();
  }

  async drain(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const id of [...this.active.keys()]) await this.release(id);
  }
}
