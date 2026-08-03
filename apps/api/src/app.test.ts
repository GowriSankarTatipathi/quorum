import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('environment validation', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/quorum',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('accepts a complete environment and applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
  });

  it('refuses to boot on a short JWT secret rather than failing on first request', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('refuses to boot when a required url is missing', () => {
    expect(() => loadEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(/DATABASE_URL/);
  });
});
