import { describe, expect, it, vi } from 'vitest';
import type { BrowserDriver, Session, SessionOptions } from './driver.js';
import { SessionLimitReachedError, SessionPool } from './session-pool.js';

function stubDriver() {
  let counter = 0;
  const closed: string[] = [];
  const driver = {
    kind: 'mock' as const,
    createSession: (opts: SessionOptions): Promise<Session> => {
      counter += 1;
      return Promise.resolve({
        id: `s${String(counter)}`,
        runId: opts.runId,
        driver: 'mock' as const,
        createdAt: new Date().toISOString(),
        liveViewUrl: null,
      });
    },
    closeSession: (id: string): Promise<void> => {
      closed.push(id);
      return Promise.resolve();
    },
  } as unknown as BrowserDriver;
  return { driver, closed };
}

const opts: SessionOptions = {
  runId: 'run_1',
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
  timezoneId: 'UTC',
  allowedHosts: [],
  respectRobotsTxt: true,
};

describe('SessionPool', () => {
  it('enforces the concurrency ceiling browser memory imposes', async () => {
    const { driver } = stubDriver();
    const pool = new SessionPool(driver, {
      maxConcurrent: 2,
      idleTimeoutMs: 60_000,
      maxSessionMs: 900_000,
    });

    await pool.acquire(opts);
    await pool.acquire(opts);
    expect(pool.hasCapacity).toBe(false);
    // Refusing beats queueing: exceeding the ceiling OOMs the machine and takes every
    // in-flight run with it.
    await expect(pool.acquire(opts)).rejects.toBeInstanceOf(SessionLimitReachedError);
  });

  it('frees capacity on release and closes the underlying session', async () => {
    const { driver, closed } = stubDriver();
    const pool = new SessionPool(driver, {
      maxConcurrent: 1,
      idleTimeoutMs: 60_000,
      maxSessionMs: 900_000,
    });
    const session = await pool.acquire(opts);
    await pool.release(session.id);
    expect(pool.size).toBe(0);
    expect(closed).toEqual([session.id]);
    await expect(pool.acquire(opts)).resolves.toBeDefined();
  });

  it('reclaims an idle session a crashed run left behind', async () => {
    let now = 1_000;
    const { driver, closed } = stubDriver();
    const pool = new SessionPool(driver, {
      maxConcurrent: 2,
      idleTimeoutMs: 60_000,
      maxSessionMs: 900_000,
      now: () => now,
    });
    const session = await pool.acquire(opts);
    now += 61_000;
    // Without this the worker gets quieter until it stops taking work, with nothing
    // in the logs to explain why.
    expect(await pool.sweep()).toEqual([session.id]);
    expect(closed).toContain(session.id);
  });

  it('keeps a session alive while it is being used', async () => {
    let now = 1_000;
    const { driver } = stubDriver();
    const pool = new SessionPool(driver, {
      maxConcurrent: 2,
      idleTimeoutMs: 60_000,
      maxSessionMs: 900_000,
      now: () => now,
    });
    const session = await pool.acquire(opts);
    now += 50_000;
    pool.touch(session.id);
    now += 50_000;
    expect(await pool.sweep()).toEqual([]);
  });

  it('reclaims a session that has run past the wall-clock ceiling even if busy', async () => {
    let now = 1_000;
    const { driver } = stubDriver();
    const pool = new SessionPool(driver, {
      maxConcurrent: 2,
      idleTimeoutMs: 600_000,
      maxSessionMs: 900_000,
      now: () => now,
    });
    const session = await pool.acquire(opts);
    for (let i = 0; i < 10; i += 1) {
      now += 100_000;
      pool.touch(session.id);
    }
    expect(await pool.sweep()).toEqual([session.id]);
  });

  it('drains everything on shutdown', async () => {
    const { driver, closed } = stubDriver();
    const pool = new SessionPool(driver, {
      maxConcurrent: 4,
      idleTimeoutMs: 60_000,
      maxSessionMs: 900_000,
    });
    await pool.acquire(opts);
    await pool.acquire(opts);
    await pool.drain();
    expect(pool.size).toBe(0);
    expect(closed).toHaveLength(2);
  });

  it('runs the sweeper on an interval without holding the process open', async () => {
    vi.useFakeTimers();
    let now = 1_000;
    const { driver } = stubDriver();
    const pool = new SessionPool(driver, {
      maxConcurrent: 2,
      idleTimeoutMs: 10_000,
      maxSessionMs: 900_000,
      now: () => now,
    });
    await pool.acquire(opts);
    const reclaimed: string[][] = [];
    pool.startSweeper(5_000, (ids) => reclaimed.push(ids));

    now += 20_000;
    await vi.advanceTimersByTimeAsync(5_000);
    await pool.drain();
    vi.useRealTimers();

    expect(reclaimed.flat()).toHaveLength(1);
  });
});
