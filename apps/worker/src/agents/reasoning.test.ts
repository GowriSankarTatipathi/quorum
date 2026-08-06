import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runReasoningAgent } from './reasoning.js';
import { claimRepository, type ClaimRecord, type CreateClaimInput } from '@quorum/db';
import * as llm from '../services/llm.js';
import { LlmRouter, ZERO_COST, type AgentCallInput, type AgentCallResult } from '@quorum/ai';
import type { ZodTypeAny, output as ZodOutput } from 'zod';

vi.mock('../services/event-publisher.js', () => ({
  eventPublisher: {
    emit: () => Promise.resolve(),
  },
}));

vi.mock('../logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));

describe('runReasoningAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('supersedes an existing claim when extracting the same entity and field in one run', async () => {
    const fakeRouter = Object.create(LlmRouter.prototype) as LlmRouter;
    Object.defineProperty(fakeRouter, 'candidates', {
      get: () => ({ reasoning: ['claude-sonnet-4-5-20250929'] }),
    });
    fakeRouter.call = <S extends ZodTypeAny>(_input: AgentCallInput, _schema: S): Promise<AgentCallResult<ZodOutput<S>>> =>
      Promise.resolve({
        model: 'claude-sonnet-4-5-20250929',
        cost: ZERO_COST,
        latencyMs: 10,
        cached: false,
        fallbackUsed: false,
        raw: '',
        data: {
          claims: [
            {
              entity: 'Ramp',
              field: 'price',
              value: 12,
              unit: 'USD',
              sourceText: '$12',
              confidence: 0.9,
              ambiguity: null,
              nullReason: null,
            },
          ],
          note: null,
          injectionDetected: false,
          injectionExcerpt: null,
        } as ZodOutput<S>,
      });

    vi.spyOn(llm, 'createRouter').mockReturnValue(fakeRouter);

    const createSpy = vi.spyOn(claimRepository, 'create').mockImplementation((claim: CreateClaimInput): Promise<ClaimRecord> =>
      Promise.resolve({
        ...claim,
        id: 'new_id',
        extractedAt: new Date(),
        sourceSelector: claim.sourceSelector ?? null,
        sourceText: claim.sourceText ?? null,
        screenshotKey: claim.screenshotKey ?? null,
        domSnapshotKey: claim.domSnapshotKey ?? null,
        unit: claim.unit ?? null,
        confidence: claim.confidence ?? null,
        ambiguity: claim.ambiguity ?? null,
        nullReason: claim.nullReason ?? null,
        status: 'UNVERIFIED',
        supersedesId: null,
        correctedBy: null,
      })
    );

    const supersedeSpy = vi.spyOn(claimRepository, 'supersede').mockImplementation((_id: string, claim: CreateClaimInput): Promise<ClaimRecord> =>
      Promise.resolve({
        ...claim,
        id: 'superseded_id',
        extractedAt: new Date(),
        sourceSelector: claim.sourceSelector ?? null,
        sourceText: claim.sourceText ?? null,
        screenshotKey: claim.screenshotKey ?? null,
        domSnapshotKey: claim.domSnapshotKey ?? null,
        unit: claim.unit ?? null,
        confidence: claim.confidence ?? null,
        ambiguity: claim.ambiguity ?? null,
        nullReason: claim.nullReason ?? null,
        status: 'UNVERIFIED',
        supersedesId: _id,
        correctedBy: null,
      })
    );

    await runReasoningAgent({
      runId: 'r1',
      stepId: 's1',
      correlationId: 'c1',
      stepObjective: 'extract price',
      outputSchema: { price: 'number' },
      url: 'https://ramp.com',
      pageContent: 'hello $12',
      capturedText: 'hello $12',
      screenshotKey: null,
      domSnapshotKey: null,
      knownFields: [{ entity: 'Ramp', field: 'price', id: 'existing_id_1' }],
    });

    expect(supersedeSpy).toHaveBeenCalledWith(
      'existing_id_1',
      expect.objectContaining({
        entity: 'Ramp',
        field: 'price',
        value: 12,
      }),
      null
    );

    expect(createSpy).not.toHaveBeenCalled();
  });
});
