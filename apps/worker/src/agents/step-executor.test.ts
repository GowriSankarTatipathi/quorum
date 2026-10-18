import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@quorum/browser';
import type { ClaimRecord, StepRecord } from '@quorum/db';
import { executeStep } from './step-executor.js';

const mocks = vi.hoisted(() => ({
  reason: vi.fn(),
  verify: vi.fn(),
  current: vi.fn(),
  capture: vi.fn(),
  put: vi.fn(),
  record: vi.fn(),
  finish: vi.fn(),
}));
vi.mock('@quorum/db', () => ({
  artifactRepository: { recordMany: mocks.record },
  claimRepository: { listCurrentForRun: vi.fn(() => Promise.resolve([])) },
  runRepository: { findById: mocks.current },
  stepRepository: { start: vi.fn(), finish: mocks.finish },
  undoFrameRepository: {},
}));
vi.mock('../services/browser.js', () => ({
  browserDriver: {
    snapshot: vi.fn(() =>
      Promise.resolve({
        url: 'https://example.com/pricing',
        tree: 'Starter $0 CSV export',
      }),
    ),
    capture: mocks.capture,
  },
}));
vi.mock('../services/storage.js', () => ({
  hasStorage: () => true,
  getStorage: () => ({ put: mocks.put }),
}));
vi.mock('../services/event-publisher.js', () => ({
  eventPublisher: { emit: vi.fn() },
  newCorrelation: () => 'c',
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('./browser.js', () => ({
  runBrowserAgent: vi.fn(() => Promise.resolve({ action: { type: 'extract_ready' } })),
}));
vi.mock('./reasoning.js', () => ({ runReasoningAgent: mocks.reason }));
vi.mock('./verification.js', () => ({ runVerificationAgent: mocks.verify }));
vi.mock('./recovery.js', () => ({ runRecoveryAgent: vi.fn() }));
vi.mock('../services/approval.js', () => ({
  awaitApproval: vi.fn(),
  ApprovalTimeoutError: class extends Error {},
}));
const price = {
  id: 'price',
  entity: 'Starter',
  field: 'price',
  value: 0,
  status: 'UNVERIFIED',
} as ClaimRecord;
const features = {
  id: 'features',
  entity: 'Starter',
  field: 'features',
  value: ['CSV export'],
  status: 'UNVERIFIED',
} as ClaimRecord;
const step = {
  id: 'step',
  runId: 'run',
  index: 0,
  targetUrl: null,
  agentPath: [],
  riskLevel: 'LOW',
  status: 'PENDING',
  notes: null,
  estimatedMs: null,
  actualMs: null,
  estimatedMicroUsd: null,
  attempt: 1,
  startedAt: null,
  endedAt: null,
  createdAt: new Date(),
  objective: 'Extract prices and features',
  outputSchema: { price: 'number', features: 'string[]' },
} as StepRecord;
const ctx = {
  runId: 'run',
  orgId: 'org',
  mode: 'BALANCED' as const,
  allowedHosts: ['example.com'],
  session: {} as Session,
  budgetRemainingUsd: () => 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.current.mockResolvedValue({
    status: 'EXECUTING',
    spentMicroUsd: 10,
    budgetMicroUsd: 1000000,
    startedAt: new Date(),
  });
  mocks.capture.mockResolvedValue({
    screenshot: Buffer.from('image'),
    html: 'Starter $0 CSV export',
    a11y: '[1] heading Starter [2] text $0 [3] listitem CSV export',
    text: 'Starter\n$0\nCSV export',
    capturedAt: new Date().toISOString(),
  });
  mocks.put.mockImplementation((key: string, bytes: Buffer) =>
    Promise.resolve({
      key,
      bytes: bytes.length,
    }),
  );
  mocks.reason
    .mockResolvedValueOnce({ claims: [price], quarantined: [], note: null })
    .mockResolvedValue({ claims: [features], quarantined: [], note: null });
});
describe('bounded evidence repair', () => {
  it('repairs a missing field once from the same capture, with evidence attached', async () => {
    await executeStep(step, ctx);
    expect(mocks.reason).toHaveBeenCalledTimes(2);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.reason.mock.calls[1]?.[0]).toMatchObject({
      repairOnly: true,
      pageContent: 'Starter\n$0\nCSV export',
      existingClaims: [price],
    });
    const repairContext = mocks.reason.mock.calls[1]?.[0] as { screenshotKey: string };
    expect(repairContext.screenshotKey).toContain('/evidence-');
    expect(mocks.verify.mock.calls[0]?.[0]).toEqual([price, features]);
  });
  it('does not retry a complete extraction', async () => {
    mocks.reason
      .mockReset()
      .mockResolvedValue({ claims: [price, features], quarantined: [], note: null });
    await executeStep(step, ctx);
    expect(mocks.reason).toHaveBeenCalledTimes(1);
  });
  it.each(['CANCELLED', 'PAUSED'])('does not repair a %s run', async (status) => {
    mocks.current.mockResolvedValue({ status, spentMicroUsd: 10, budgetMicroUsd: 1000000 });
    await executeStep(step, ctx);
    expect(mocks.reason).toHaveBeenCalledTimes(1);
  });
  it('does not repair when the budget is exhausted', async () => {
    mocks.current.mockResolvedValue({
      status: 'EXECUTING',
      spentMicroUsd: 100,
      budgetMicroUsd: 100,
    });
    await executeStep(step, ctx);
    expect(mocks.reason).toHaveBeenCalledTimes(1);
  });
  it('stops after one unsuccessful repair', async () => {
    mocks.reason.mockReset().mockResolvedValue({
      claims: [price],
      quarantined: [{ entity: 'Starter', field: 'features', reason: 'quote missing' }],
      note: null,
    });
    await executeStep(step, ctx);
    expect(mocks.reason).toHaveBeenCalledTimes(2);
  });
});
