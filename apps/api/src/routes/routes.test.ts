import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// ── External dependency stubs ──────────────────────────────────────────────────
// buildApp() eagerly connects to Redis and registers BullMQ queues at import
// time. These stubs prevent the test from requiring running infrastructure while
// still exercising the real Fastify plugin registration tree.
//
// vi.mock factories are hoisted above all other code, so every mock must be
// self-contained — no references to top-level variables.

vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  class MockRedis extends EventEmitter {
    status = 'ready';
    ping() { return Promise.resolve('PONG'); }
    quit() { return Promise.resolve(); }
    subscribe() { return Promise.resolve(); }
    unsubscribe() { return Promise.resolve(); }
    lpush() { return Promise.resolve(1); }
    expire() { return Promise.resolve(1); }
    get() { return Promise.resolve(null); }
    set() { return Promise.resolve('OK'); }
    del() { return Promise.resolve(1); }
    incr() { return Promise.resolve(1); }
    pttl() { return Promise.resolve(-1); }
    defineCommand() { /* @fastify/rate-limit calls this to register lua scripts */ }
    rlflxFixed() { return Promise.resolve([0, 0]); }
    rlflxSliding() { return Promise.resolve([0, 0]); }
    call() { return Promise.resolve(null); }
    disconnect() { return; }
  }
  return { Redis: MockRedis, default: MockRedis };
});

vi.mock('bullmq', () => {
  class MockQueue {
    add() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  return { Queue: MockQueue };
});

vi.mock('@quorum/db', () => ({
  checkDatabase: () => Promise.resolve({ ok: true, latencyMs: 1 }),
  orgRepository: {},
  userRepository: {},
  runRepository: {},
  stepRepository: {},
  claimRepository: {},
  eventRepository: {},
  approvalRepository: {},
  critiqueRepository: {},
  artifactRepository: {},
  authEventRepository: {},
}));

vi.mock('@quorum/auth', () => ({
  verifyAccessToken: () => Promise.resolve({ sub: 'u', org: 'o', ver: 1, role: 'ADMIN' }),
  capabilitiesFromClaims: () => ({
    permissions: new Set(),
    approvalCeiling: null,
    canApproveAnything: false,
  }),
  claimsCanApprove: () => true,
  accountDisabled: () => false,
  staleTokenVersion: () => false,
  tokenRevoked: () => false,
  AuthError: class extends Error {},
}));

vi.mock('@quorum/auth/server', () => ({
  AccessTokenDenylist: class {
    isRevoked() { return Promise.resolve(false); }
  },
}));

vi.mock('@quorum/storage', () => ({
  ArtifactStorage: class {
    signedUrl() { return Promise.resolve('https://example.com/signed'); }
  },
  downloadFilename: () => 'export.xlsx',
}));

// ── Test ────────────────────────────────────────────────────────────────────────

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';

/**
 * Every method+path pair the web client and the OpenAPI spec depend on.
 *
 * This list is intentionally exhaustive: a route file that exists but is never
 * registered in buildApp() will cause a test failure, preventing a repeat of the
 * original bug where four complete route files were silently unreachable.
 */
const EXPECTED_ROUTES: ReadonlyArray<{ method: string; path: string }> = [
  // health.ts (no prefix)
  { method: 'GET', path: '/healthz' },
  { method: 'GET', path: '/readyz' },

  // app.ts inline (prefix /v1)
  { method: 'GET', path: '/v1/' },

  // me.ts (prefix /v1)
  { method: 'GET', path: '/v1/me' },
  { method: 'GET', path: '/v1/me/capabilities' },
  { method: 'GET', path: '/v1/org' },
  { method: 'PATCH', path: '/v1/org/policy' },

  // runs.ts (prefix /v1)
  { method: 'POST', path: '/v1/runs' },
  { method: 'GET', path: '/v1/runs' },
  { method: 'GET', path: '/v1/runs/{runId}' },
  { method: 'GET', path: '/v1/runs/{runId}/events' },
  { method: 'POST', path: '/v1/runs/estimate' },

  // control.ts (prefix /v1)
  { method: 'POST', path: '/v1/runs/{runId}/plan/approve' },
  { method: 'POST', path: '/v1/runs/{runId}/control' },
  { method: 'POST', path: '/v1/approvals/{approvalId}' },
  { method: 'POST', path: '/v1/critiques/{critiqueId}/resolve' },

  // exports.ts (prefix /v1)
  { method: 'POST', path: '/v1/runs/{runId}/export' },
  { method: 'GET', path: '/v1/runs/{runId}/export' },

  // ws.ts (absolute path, no prefix — checked separately via hasRoute)
  { method: 'GET', path: '/v1/ws' },
];

describe('route registration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Collects every method+path from Fastify's generated OpenAPI spec. Swagger UI
   * and other framework-internal routes (e.g. /docs/*) are excluded — only the
   * application routes matter.
   */
  function registeredRoutes(): Array<{ method: string; path: string }> {
    const swagger = app.swagger();
    const routes: Array<{ method: string; path: string }> = [];
    for (const [path, operations] of Object.entries(swagger.paths ?? {})) {
      for (const method of Object.keys(operations as Record<string, unknown>)) {
        routes.push({ method: method.toUpperCase(), path });
      }
    }
    return routes;
  }

  it('registers every expected API route', () => {
    const actual = registeredRoutes();
    const actualSet = new Set(actual.map((r) => `${r.method} ${r.path}`));

    for (const expected of EXPECTED_ROUTES) {
      // The WebSocket upgrade route is not part of the OpenAPI spec, so we
      // check it separately below.
      if (expected.path === '/v1/ws') continue;

      expect(
        actualSet.has(`${expected.method} ${expected.path}`),
        `Missing route: ${expected.method} ${expected.path}`,
      ).toBe(true);
    }
  });

  it('does not contain unexpected application routes', () => {
    const actual = registeredRoutes();
    const expectedSet = new Set(EXPECTED_ROUTES.map((r) => `${r.method} ${r.path}`));

    for (const route of actual) {
      expect(
        expectedSet.has(`${route.method} ${route.path}`),
        `Unexpected route registered: ${route.method} ${route.path}`,
      ).toBe(true);
    }
  });

  it('registers the WebSocket upgrade route at /v1/ws', () => {
    // WebSocket routes do not appear in the OpenAPI spec; verify registration
    // by checking that Fastify has a handler for GET /v1/ws.
    const hasRoute = app.hasRoute({ method: 'GET', url: '/v1/ws' });
    expect(hasRoute, 'WebSocket route GET /v1/ws is not registered').toBe(true);
  });
});
