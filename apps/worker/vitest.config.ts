import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://quorum:quorum@localhost:5432/quorum_test',
      REDIS_URL: 'redis://localhost:6379',
    },
  },
});
