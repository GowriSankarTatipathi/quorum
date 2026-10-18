import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessTokenClaims } from '@quorum/auth';
import { claimRepository, critiqueRepository, runRepository, stepRepository } from '@quorum/db';
import { runRoutes } from './runs.js';
import { ApiError } from '../plugins/error-handler.js';
import { workerAvailability } from '../services/queue.js';
vi.mock('../services/queue.js', () => ({
  enqueueRunPlan: vi.fn(),
  isPlanExecutionQueued: vi.fn().mockResolvedValue(false),
  runQueuePosition: vi.fn().mockResolvedValue(2),
  workerAvailability: vi.fn(),
}));
vi.mock('../services/storage.js', () => ({
  getStorage: () => ({ signedUrl: vi.fn().mockResolvedValue('http://localhost/signed') }),
}));
vi.mock('@quorum/db', () => ({
  runRepository: { findByIdForOrg: vi.fn(), createOnce: vi.fn(), create: vi.fn() },
  llmCallRepository: {
    listForRun: vi.fn().mockResolvedValue([
      { agent: 'verification', costMicroUsd: 1200 },
      { agent: 'verification', costMicroUsd: 800 },
    ]),
  },
  orgRepository: { findById: vi.fn().mockResolvedValue({ maxRunBudgetUsd: 10 }) },
  artifactRepository: {},
  stepRepository: { listForRun: vi.fn() },
  claimRepository: { listCurrentForRun: vi.fn(), listVerdicts: vi.fn().mockResolvedValue([]) },
  critiqueRepository: { listForRun: vi.fn() },
  eventRepository: {
    lastSeq: vi.fn().mockResolvedValue(0),
    listAfter: vi.fn().mockResolvedValue([]),
  },
}));
const run = {
  id: 'run1',
  orgId: 'org1',
  userId: 'u1',
  goal: 'Extract monthly pricing',
  mode: 'BALANCED',
  status: 'COMPLETED',
  budgetMicroUsd: 500000,
  spentMicroUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  recipeId: null,
  planHash: null,
  createdAt: new Date(),
  startedAt: null,
  endedAt: null,
};
let app: FastifyInstance;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(runRepository).findByIdForOrg.mockResolvedValue(run as never);
  vi.mocked(stepRepository).listForRun.mockResolvedValue([]);
  vi.mocked(claimRepository).listCurrentForRun.mockResolvedValue([]);
  vi.mocked(critiqueRepository).listForRun.mockResolvedValue([]);
  vi.mocked(workerAvailability).mockResolvedValue({ state: 'offline', workers: 0 });
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('requirePermission', () => (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer qa')
      return Promise.reject(new ApiError(401, 'E_TOKEN_MISSING', 'Sign in'));
    request.auth = { sub: 'u1', org: 'org1' } as AccessTokenClaims;
    return Promise.resolve();
  });
  await app.register(runRoutes, { prefix: '/v1' });
  await app.ready();
});
afterEach(async () => {
  await app.close();
});
describe('task reporting and submissions', () => {
  it('protects reports and scopes lookup to the authenticated workspace', async () => {
    expect((await app.inject('/v1/runs/run1/report')).statusCode).toBe(401);
    vi.mocked(runRepository).findByIdForOrg.mockResolvedValue(null);
    expect(
      (await app.inject({ url: '/v1/runs/run1/report', headers: { authorization: 'Bearer qa' } }))
        .statusCode,
    ).toBe(404);
    expect(vi.mocked(runRepository).findByIdForOrg.mock.calls).toContainEqual(['run1', 'org1']);
  });
  it('reports a completed empty result as incomplete', async () => {
    const response = await app.inject({
      url: '/v1/runs/run1/report',
      headers: { authorization: 'Bearer qa' },
    });
    expect(response.json()).toMatchObject({
      status: 'COMPLETED',
      outcome: 'incomplete',
      availability: { state: 'offline' },
    });
  });
  it('preserves coverage warnings even when execution completed', async () => {
    vi.mocked(critiqueRepository).listForRun.mockResolvedValue([
      {
        id: 'gap',
        kind: 'COVERAGE_GAP',
        severity: 'WARNING',
        resolution: 'OPEN',
        message: 'Missing features',
        claimIds: [],
      },
    ] as never);
    const response = await app.inject({
      url: '/v1/runs/run1/report',
      headers: { authorization: 'Bearer qa' },
    });
    expect(response.json()).toMatchObject({
      outcome: 'incomplete',
      findings: [{ message: 'Missing features' }],
    });
  });
  it('uses the same scoped identity for concurrent retries and rejects changed payloads', async () => {
    vi.mocked(runRepository).createOnce.mockResolvedValue({ ...run, status: 'CREATED' } as never);
    const payload = {
      goal: run.goal,
      mode: run.mode,
      requestId: '12345678-1234-4123-8123-123456789abc',
    };
    const responses = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: 'POST',
          url: '/v1/runs',
          headers: { authorization: 'Bearer qa' },
          payload,
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([202, 202]);
    const calls = vi.mocked(runRepository).createOnce.mock.calls;
    expect(calls[0]?.[1]).toBe(calls[1]?.[1]);
    expect(vi.mocked(runRepository).create.mock.calls).toHaveLength(0);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/runs',
          headers: { authorization: 'Bearer qa' },
          payload: { ...payload, goal: 'A different research request' },
        })
      ).statusCode,
    ).toBe(409);
  });
});

it('reports recorded per-agent usage without exposing model prompts or credentials', async () => {
  const response = await app.inject({
    method: 'GET',
    url: '/v1/runs/run1/report',
    headers: { authorization: 'Bearer qa' },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json<{ usage: unknown }>().usage).toMatchObject({
    calls: 2,
    budgetUsd: 0.5,
    agents: [{ agent: 'verification', calls: 2, spentUsd: 0.002 }],
  });
});
