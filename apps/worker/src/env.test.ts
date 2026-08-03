import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/quorum',
  REDIS_URL: 'redis://localhost:6379',
} as NodeJS.ProcessEnv;

describe('worker environment', () => {
  it('defaults concurrency to what fits a 2GB machine', () => {
    expect(loadEnv(base).MAX_CONCURRENT_SESSIONS).toBe(4);
  });

  it('coerces and bounds session concurrency', () => {
    expect(loadEnv({ ...base, MAX_CONCURRENT_SESSIONS: '8' }).MAX_CONCURRENT_SESSIONS).toBe(8);
    expect(() => loadEnv({ ...base, MAX_CONCURRENT_SESSIONS: '99' })).toThrow();
  });

  it('parses RESPECT_ROBOTS_TXT into a boolean and defaults it on', () => {
    expect(loadEnv(base).RESPECT_ROBOTS_TXT).toBe(true);
    expect(loadEnv({ ...base, RESPECT_ROBOTS_TXT: 'false' }).RESPECT_ROBOTS_TXT).toBe(false);
  });

  it('rejects an unknown browser driver', () => {
    expect(() => loadEnv({ ...base, BROWSER_DRIVER: 'selenium' })).toThrow();
  });
});
