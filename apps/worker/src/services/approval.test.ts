import { beforeEach, expect, it, vi } from 'vitest';
import { approvalRepository } from '@quorum/db';
import { createRedis } from '../redis.js';
import { eventPublisher } from './event-publisher.js';
import { awaitApproval } from './approval.js';
vi.mock('@quorum/db', () => ({
  approvalRepository: { hasRunScopedConsent: vi.fn(), request: vi.fn(), timeout: vi.fn() },
}));
vi.mock('../redis.js', () => ({ createRedis: vi.fn() }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn() } }));
vi.mock('../env.js', () => ({ env: { APPROVAL_TIMEOUT_S: 60 } }));
vi.mock('./event-publisher.js', () => ({ eventPublisher: { emit: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(approvalRepository).hasRunScopedConsent.mockResolvedValue(false);
  vi.mocked(approvalRepository).request.mockResolvedValue({ id: 'approval1' } as never);
});
it.each(['APPROVED', 'REJECTED'] as const)(
  'publishes a durable resolution when the human chooses %s',
  async (decision) => {
    const quit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createRedis).mockReturnValue({
      blpop: vi
        .fn()
        .mockResolvedValue([
          'key',
          JSON.stringify({ decision, userId: 'user1', editedPayload: null, scope: 'SINGLE' }),
        ]),
      quit,
    } as never);
    const result = await awaitApproval({
      runId: 'run1',
      stepId: 'step1',
      correlationId: 'corr1',
      trustLevel: 4,
      action: { type: 'navigate' },
      payload: null,
      screenshotKey: null,
      reason: 'Review destination',
    });
    expect(result.decision).toBe(decision);
    expect(vi.mocked(eventPublisher).emit.mock.calls).toContainEqual([
      decision === 'APPROVED' ? 'approval.granted' : 'approval.rejected',
      expect.objectContaining({ approvalId: 'approval1', by: 'user1' }),
      expect.objectContaining({ runId: 'run1', stepId: 'step1' }),
    ]);
    expect(quit).toHaveBeenCalledOnce();
  },
);
