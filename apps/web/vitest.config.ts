import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` is a build-time guard that throws when a module is pulled into a
      // client bundle. Under vitest every module is server-side by definition, so it is
      // resolved to the package's own no-op entry — the same file Next uses for the
      // react-server condition.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://quorum:quorum@localhost:5432/quorum_test',
      AUTH_SECRET: 'test-auth-secret-at-least-thirty-two-chars',
      JWT_SECRET: 'test-jwt-secret-that-is-at-least-32-characters',
      EMAIL_SERVER_HOST: 'localhost',
      EMAIL_SERVER_PORT: '1025',
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
});
