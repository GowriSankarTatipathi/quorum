import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    /**
     * `env.ts` validates configuration eagerly at import time and throws — that
     * fail-fast behaviour is deliberate, so the test process is given a valid
     * configuration rather than the module being weakened to accommodate tests.
     */
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://quorum:quorum@localhost:5432/quorum_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    },
  },
});
