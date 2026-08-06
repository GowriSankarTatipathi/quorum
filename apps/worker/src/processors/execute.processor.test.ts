/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import { processRunExecute, type ExecuteJobData } from './execute.processor.js';
import {
  runRepository,
  stepRepository,
  claimRepository,
  eventRepository,
  type RunRecord,
  type StepRecord,
} from '@quorum/db';

import { browserDriver, sessionPool } from '../services/browser.js';
import { getStorage, hasStorage } from '../services/storage.js';
import type { ArtifactStore } from '@quorum/storage';
import { executeStep } from '../agents/step-executor.js';
import type { Session } from '@quorum/browser';
import { publisher } from '../redis.js';
import type * as EventPublisher from '../services/event-publisher.js';

vi.mock('@quorum/db', () => ({
  runRepository: {
    findById: vi.fn(),
    attachSession: vi.fn(),
    setStatus: vi.fn(),
  },
  stepRepository: {
    listForRun: vi.fn(),
  },
  critiqueRepository: {
    hasUnresolvedBlocking: vi.fn(),
  },
  claimRepository: {
    verifiedRate: vi.fn(),
  },
  eventRepository: {
    append: vi.fn(),
    lastSeq: vi.fn(),
  },
}));

vi.mock('../services/event-publisher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof EventPublisher>();
  return {
    ...actual,
    newCorrelation: vi.fn(() => 'corr-1'),
  };
});

vi.mock('../redis.js', () => ({
  publisher: {
    publish: vi.fn(),
  },
}));

vi.mock('../services/browser.js', () => ({
  browserDriver: {
    kind: 'mock',
    screenshot: vi.fn(),
    streamScreencast: vi.fn((_s, onFrame: (b: Buffer) => void) => {
      const timer = setInterval(() => onFrame(Buffer.from('fake')), 500);
      return Promise.resolve(() => {
        clearInterval(timer);
        return Promise.resolve();
      });
    }),
  },
  sessionPool: {
    acquire: vi.fn(),
    touch: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock('../services/storage.js', () => ({
  hasStorage: vi.fn(),
  getStorage: vi.fn(),
}));

vi.mock('../agents/critic.js', () => ({
  runCriticAgent: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../agents/step-executor.js', () => ({
  executeStep: vi.fn(),
}));

describe('processRunExecute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts the screenshot loop and emits at least one browser.screenshot event', async () => {
    const runId = 'run_123';
    const job = { data: { runId } } as unknown as Job<ExecuteJobData>;

    const mockRun: RunRecord = {
      id: runId,
      status: 'AWAITING_APPROVAL',
      orgId: 'org_1',
      userId: 'user_1',
      goal: 'test',
      mode: 'BALANCED',
      budgetMicroUsd: 1000000,
      spentMicroUsd: 0,
      planHash: 'hash',
      inputTokens: 0,
      outputTokens: 0,
      browserSessionId: null,
      liveViewUrl: null,
      errorCode: null,
      errorDetail: null,
      startedAt: null,
      endedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      recipeId: null,
    };

    vi.mocked(runRepository.findById).mockResolvedValue(mockRun);

    const mockStep: StepRecord = {
      id: 'step_1',
      runId,
      index: 0,
      objective: 'test',
      targetUrl: 'https://example.com',
      agentPath: [],
      outputSchema: null,
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
    };
    vi.mocked(stepRepository.listForRun).mockResolvedValue([mockStep]);
    vi.mocked(claimRepository.verifiedRate).mockResolvedValue({ total: 0, verified: 0, rate: 0 });

    const mockSession: Session = {
      id: 'session_1',
      runId,
      driver: 'mock',
      createdAt: new Date().toISOString(),
      liveViewUrl: 'http://localhost/live',
    };
    vi.mocked(sessionPool.acquire).mockResolvedValue(mockSession);

    const mockStorage: ArtifactStore = {
      kind: 'filesystem',
      put: vi.fn().mockResolvedValue(undefined),
      signedUrl: vi.fn().mockResolvedValue('http://signed.url'),
      get: vi.fn().mockResolvedValue(Buffer.from('fake')),
      deletePrefix: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockResolvedValue(true),
    } as unknown as ArtifactStore;
    vi.mocked(hasStorage).mockReturnValue(true);
    vi.mocked(getStorage).mockReturnValue(mockStorage);

    vi.mocked(browserDriver.screenshot).mockResolvedValue(Buffer.from('fake'));

    vi.mocked(executeStep).mockImplementation(async () => {
      // The stream loop waits 500ms per iteration. Wait 600ms to guarantee one frame is captured
      // before this step returns, which will eventually tear down the stream loop.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { kind: 'done', claimCount: 0, quarantinedCount: 0 };
    });

    await processRunExecute(job);

    expect(executeStep).toHaveBeenCalled();
    expect(mockStorage.put).toHaveBeenCalled();
    expect(mockStorage.signedUrl).toHaveBeenCalled();

    // Assert that a browser.screenshot event was emitted to redis
    const publishedEvents = vi.mocked(publisher.publish).mock.calls;
    const screenshotEventStr = publishedEvents.find((call) =>
      call[1].includes('"type":"browser.screenshot"'),
    );

    expect(screenshotEventStr).toBeDefined();
    const parsedEvent = JSON.parse(screenshotEventStr![1].toString()) as { payload: unknown };
    expect(parsedEvent.payload).toMatchObject({
      url: 'http://signed.url',
    });

    // Assert that no browser.screenshot event was written to the database
    const appendedEvents = vi.mocked(eventRepository.append).mock.calls;
    const appendedScreenshot = appendedEvents.find((call) => call[0].type === 'browser.screenshot');
    expect(appendedScreenshot).toBeUndefined();
  });

  it('cleans up stream frames but retains provenance frames when run completes', async () => {
    const runId = 'run_124';
    const job = { data: { runId } } as unknown as Job<ExecuteJobData>;

    const mockRun: RunRecord = {
      id: runId,
      status: 'AWAITING_APPROVAL',
      orgId: 'org_1',
      userId: 'user_1',
      goal: 'test',
      mode: 'BALANCED',
      budgetMicroUsd: 1000000,
      spentMicroUsd: 0,
      planHash: 'hash',
      inputTokens: 0,
      outputTokens: 0,
      browserSessionId: null,
      liveViewUrl: null,
      errorCode: null,
      errorDetail: null,
      startedAt: null,
      endedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      recipeId: null,
    };

    const mockStep: StepRecord = {
      id: 'step_1',
      runId,
      index: 0,
      objective: 'test',
      targetUrl: 'https://example.com',
      agentPath: [],
      outputSchema: null,
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
    };

    // The findById is called multiple times. We simulate it eventually becoming COMPLETED
    vi.mocked(runRepository.findById)
      .mockResolvedValueOnce(mockRun)
      .mockResolvedValueOnce(mockRun)
      .mockResolvedValue({ ...mockRun, status: 'COMPLETED' });

    vi.mocked(stepRepository.listForRun).mockResolvedValue([mockStep]);
    vi.mocked(claimRepository.verifiedRate).mockResolvedValue({ total: 0, verified: 0, rate: 0 });

    const mockSession = {
      id: 'session_1',
      runId,
      driver: 'mock',
      createdAt: new Date().toISOString(),
      liveViewUrl: 'http://localhost/live',
    } as unknown as Session;
    vi.mocked(sessionPool.acquire).mockResolvedValue(mockSession);

    const mockStorage: ArtifactStore = {
      kind: 'filesystem',
      put: vi.fn().mockResolvedValue(undefined),
      signedUrl: vi.fn().mockResolvedValue('http://signed.url'),
      get: vi.fn().mockResolvedValue(Buffer.from('fake')),
      deletePrefix: vi.fn().mockResolvedValue(1),
      exists: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(hasStorage).mockReturnValue(true);
    vi.mocked(getStorage).mockReturnValue(mockStorage);
    vi.mocked(browserDriver.screenshot).mockResolvedValue(Buffer.from('fake'));

    vi.mocked(executeStep).mockImplementation(async () => {
      // Simulate taking a provenance screenshot by writing to storage directly
      await mockStorage.put(
        `runs/${runId}/steps/step_1/shot-123.jpg`,
        Buffer.from('prov'),
        'image/jpeg',
      );
      return { kind: 'done', claimCount: 1, quarantinedCount: 0 };
    });

    await processRunExecute(job);

    // Verify stream cleanup happened
    expect(mockStorage.deletePrefix).toHaveBeenCalledWith(`runs/${runId}/stream/`);

    // Verify no other deletes happened (provenance screenshots are untouched)
    const deletions = vi.mocked(mockStorage.deletePrefix).mock.calls;
    expect(deletions.length).toBe(1);

    // Verify final screenshot was taken
    const puts = vi.mocked(mockStorage.put).mock.calls;
    const finalShot = puts.find((call) => call[0].includes('/final-'));
    expect(finalShot).toBeDefined();

    // Verify browser.session.closed event has finalFrameUrl
    const publishedEvents = vi.mocked(publisher.publish).mock.calls;
    const sessionClosedStr = publishedEvents.find((call) =>
      call[1].includes('"type":"browser.session.closed"'),
    );
    expect(sessionClosedStr).toBeDefined();
    const parsedClosed = JSON.parse(sessionClosedStr![1].toString()) as {
      payload: { finalFrameUrl: string };
    };
    expect(parsedClosed.payload.finalFrameUrl).toBe('http://signed.url');
  });

  it('catches terminal errors from executeStep and fails the run cleanly', async () => {
    const runId = 'run_terminal_fail';
    const job = { data: { runId } } as unknown as Job<ExecuteJobData>;

    const mockRun = {
      id: runId,
      status: 'AWAITING_APPROVAL',
      planHash: 'hash',
      orgId: 'org_1',
    } as RunRecord;
    vi.mocked(runRepository.findById).mockResolvedValue(mockRun);

    const mockStep = { id: 'step_1', runId, status: 'PENDING' } as StepRecord;
    vi.mocked(stepRepository.listForRun).mockResolvedValue([mockStep]);
    vi.mocked(claimRepository.verifiedRate).mockResolvedValue({ total: 0, verified: 0, rate: 0 });

    const mockSession = { id: 's_1' } as Session;
    vi.mocked(sessionPool.acquire).mockResolvedValue(mockSession);
    vi.mocked(hasStorage).mockReturnValue(false);

    // Simulate a terminal error
    const terminalError = new Error('All providers failed');
    vi.mocked(executeStep).mockRejectedValue(terminalError);

    await processRunExecute(job);

    expect(runRepository.setStatus).toHaveBeenCalledWith(runId, 'FAILED');

    const publishedEvents = vi.mocked(publisher.publish).mock.calls;
    const runFailedStr = publishedEvents.find((call) => call[1].includes('"type":"run.failed"'));
    expect(runFailedStr).toBeDefined();
  });
});
