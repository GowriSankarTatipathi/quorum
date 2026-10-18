import { beforeEach, expect, it, vi } from 'vitest';
import { runCriticAgent } from './critic.js';
const mocks = vi.hoisted(() => ({
  claims: vi.fn(),
  steps: vi.fn(),
  create: vi.fn(),
  call: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@quorum/db', () => ({
  claimRepository: { listCurrentForRun: mocks.claims },
  stepRepository: { listForRun: mocks.steps },
  critiqueRepository: { create: mocks.create },
}));
vi.mock('../services/event-publisher.js', () => ({ eventPublisher: { emit: mocks.emit } }));
vi.mock('../services/llm.js', () => ({ createRouter: () => ({ call: mocks.call }) }));
const context = {
  runId: 'run',
  correlationId: 'c',
  goal: 'Extract prices and features',
  expectedEntityCount: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.steps.mockResolvedValue([
    {
      id: 'step',
      index: 0,
      targetUrl: 'https://example.com',
      outputSchema: { price: 'number', features: 'string[]' },
    },
  ]);
  mocks.create.mockImplementation((input: Record<string, unknown>) =>
    Promise.resolve({
      ...input,
      id: 'critique',
    }),
  );
  mocks.call.mockResolvedValue({ data: { critiques: [] } });
});
it('records a coverage warning without paying for a critic call when no data was extracted', async () => {
  mocks.claims.mockResolvedValue([]);
  const results = await runCriticAgent(context);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ kind: 'COVERAGE_GAP', severity: 'WARNING' });
  expect(mocks.call).not.toHaveBeenCalled();
  expect(mocks.emit.mock.calls.some(([type]) => type === 'critique.raised')).toBe(true);
});
it('does not mark fields missing when another step already extracted them from the same source', async () => {
  mocks.claims.mockResolvedValue([
    {
      id: 'p',
      stepId: 'earlier',
      sourceUrl: 'https://example.com',
      entity: 'Starter',
      field: 'price',
      value: 0,
    },
    {
      id: 'f',
      stepId: 'later',
      sourceUrl: 'https://example.com',
      entity: 'Starter',
      field: 'features',
      value: ['CSV export'],
    },
  ]);
  expect(await runCriticAgent(context)).toEqual([]);
  expect(mocks.create).not.toHaveBeenCalled();
});
it('does not use data from a different source to fill missing fields', async () => {
  mocks.claims.mockResolvedValue([
    {
      id: 'p',
      stepId: 'elsewhere',
      sourceUrl: 'https://other.example',
      entity: 'Starter',
      field: 'price',
      value: 0,
    },
  ]);
  expect(await runCriticAgent(context)).toHaveLength(1);
});
