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
    fakeRouter.call = <S extends ZodTypeAny>(
      _input: AgentCallInput,
      _schema: S,
    ): Promise<AgentCallResult<ZodOutput<S>>> =>
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

    const createSpy = vi
      .spyOn(claimRepository, 'create')
      .mockImplementation((claim: CreateClaimInput): Promise<ClaimRecord> =>
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
        }),
      );

    const supersedeSpy = vi
      .spyOn(claimRepository, 'supersede')
      .mockImplementation((_id: string, claim: CreateClaimInput): Promise<ClaimRecord> =>
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
        }),
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
      existingClaims: [
        { entity: 'Ramp', field: 'price', id: 'existing_id_1', value: 10, status: 'VERIFIED' },
      ],
    });

    expect(supersedeSpy).toHaveBeenCalledWith(
      'existing_id_1',
      expect.objectContaining({
        entity: 'Ramp',
        field: 'price',
        value: 12,
      }),
      null,
    );

    expect(createSpy).not.toHaveBeenCalled();
  });
});

it('three steps over the same page yield exactly one claim per entity+field without dropping coverage', async () => {
  // 1. First step extracts Starter price successfully, but Enterprise price as null
  const fakeRouter1 = Object.create(LlmRouter.prototype) as LlmRouter;
  Object.defineProperty(fakeRouter1, 'candidates', { get: () => ({ reasoning: ['claude'] }) });
  fakeRouter1.call = vi.fn().mockResolvedValue({
    model: 'claude',
    cost: ZERO_COST,
    latencyMs: 10,
    cached: false,
    fallbackUsed: false,
    raw: '',
    data: {
      claims: [
        {
          entity: 'Starter',
          field: 'price',
          value: 10,
          unit: 'USD',
          sourceText: '$10',
          confidence: 0.9,
          ambiguity: null,
          nullReason: null,
        },
        {
          entity: 'Enterprise',
          field: 'price',
          value: null,
          unit: null,
          sourceText: '',
          confidence: null,
          ambiguity: null,
          nullReason: 'not found',
        },
      ],
      note: null,
      injectionDetected: false,
      injectionExcerpt: null,
    },
  });

  vi.spyOn(llm, 'createRouter').mockReturnValueOnce(fakeRouter1);

  const createSpy = vi.spyOn(claimRepository, 'create').mockImplementation((claim) =>
    Promise.resolve({
      ...claim,
      id: 'id_' + claim.entity,
      extractedAt: new Date(),
      status: 'UNVERIFIED',
      supersedesId: null,
      correctedBy: null,
    } as ClaimRecord),
  );
  const supersedeSpy = vi.spyOn(claimRepository, 'supersede').mockImplementation((_id, claim) =>
    Promise.resolve({
      ...claim,
      id: 'id_' + claim.entity + '_v2',
      extractedAt: new Date(),
      status: 'UNVERIFIED',
      supersedesId: _id,
      correctedBy: null,
    } as ClaimRecord),
  );

  await runReasoningAgent({
    runId: 'r1',
    stepId: 's1',
    correlationId: 'c1',
    stepObjective: 'prices',
    outputSchema: { price: 'number' },
    url: 'https://example.com',
    pageContent: 'Starter $10, Enterprise $20',
    capturedText: 'Starter $10, Enterprise $20',
    screenshotKey: null,
    domSnapshotKey: null,
    existingClaims: [],
  });

  expect(createSpy).toHaveBeenCalledTimes(2);
  createSpy.mockClear();

  // 2. Second step sees Starter (verified) and Enterprise (unverified null).
  // The prompt hint should only include Starter. The model extracts Enterprise.
  const fakeRouter2 = Object.create(LlmRouter.prototype) as LlmRouter;
  Object.defineProperty(fakeRouter2, 'candidates', { get: () => ({ reasoning: ['claude'] }) });
  let capturedArgs2: AgentCallInput | undefined;
  fakeRouter2.call = <S extends ZodTypeAny>(
    input: AgentCallInput,
    _schema: S,
  ): Promise<AgentCallResult<ZodOutput<S>>> => {
    capturedArgs2 = input;
    return Promise.resolve({
      model: 'claude-sonnet-4-5-20250929',
      cost: ZERO_COST,
      latencyMs: 10,
      cached: false,
      fallbackUsed: false,
      raw: '',
      data: {
        claims: [
          {
            entity: 'Enterprise',
            field: 'price',
            value: 20,
            unit: 'USD',
            sourceText: '$20',
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
  };

  vi.spyOn(llm, 'createRouter').mockReturnValueOnce(fakeRouter2);

  const existingAfterStep1 = [
    { entity: 'Starter', field: 'price', id: 'id_Starter', value: 10, status: 'VERIFIED' },
    {
      entity: 'Enterprise',
      field: 'price',
      id: 'id_Enterprise',
      value: null,
      status: 'UNVERIFIED',
    },
  ];

  await runReasoningAgent({
    runId: 'r1',
    stepId: 's2',
    correlationId: 'c2',
    stepObjective: 'prices',
    outputSchema: { price: 'number' },
    url: 'https://example.com',
    pageContent: 'Starter $10, Enterprise $20',
    capturedText: 'Starter $10, Enterprise $20',
    screenshotKey: null,
    domSnapshotKey: null,
    existingClaims: existingAfterStep1,
  });

  // The router call should have passed only Starter in the prompt hint
  expect(capturedArgs2!.user).toContain(
    '<already_extracted>\n- Starter (we have: price)\n</already_extracted>',
  );

  // Enterprise was extracted again and it superseded the null one
  expect(supersedeSpy).toHaveBeenCalledTimes(1);
  expect(supersedeSpy).toHaveBeenCalledWith(
    'id_Enterprise',
    expect.objectContaining({ value: 20 }),
    null,
  );
  supersedeSpy.mockClear();

  // 3. Third step sees both as verified. The prompt hint includes both. The model extracts nothing.
  const fakeRouter3 = Object.create(LlmRouter.prototype) as LlmRouter;
  Object.defineProperty(fakeRouter3, 'candidates', { get: () => ({ reasoning: ['claude'] }) });
  let capturedArgs3: AgentCallInput | undefined;
  fakeRouter3.call = <S extends ZodTypeAny>(
    input: AgentCallInput,
    _schema: S,
  ): Promise<AgentCallResult<ZodOutput<S>>> => {
    capturedArgs3 = input;
    return Promise.resolve({
      model: 'claude-sonnet-4-5-20250929',
      cost: ZERO_COST,
      latencyMs: 10,
      cached: false,
      fallbackUsed: false,
      raw: '',
      data: {
        claims: [],
        note: null,
        injectionDetected: false,
        injectionExcerpt: null,
      } as ZodOutput<S>,
    });
  };

  vi.spyOn(llm, 'createRouter').mockReturnValueOnce(fakeRouter3);

  const existingAfterStep2 = [
    { entity: 'Starter', field: 'price', id: 'id_Starter', value: 10, status: 'VERIFIED' },
    { entity: 'Enterprise', field: 'price', id: 'id_Enterprise_v2', value: 20, status: 'VERIFIED' },
  ];

  const res3 = await runReasoningAgent({
    runId: 'r1',
    stepId: 's3',
    correlationId: 'c3',
    stepObjective: 'prices',
    outputSchema: { price: 'number' },
    url: 'https://example.com',
    pageContent: 'Starter $10, Enterprise $20',
    capturedText: 'Starter $10, Enterprise $20',
    screenshotKey: null,
    domSnapshotKey: null,
    existingClaims: existingAfterStep2,
  });

  expect(capturedArgs3!.user).toContain(
    '<already_extracted>\n- Starter (we have: price)\n- Enterprise (we have: price)\n</already_extracted>',
  );

  expect(createSpy).not.toHaveBeenCalled();
  expect(supersedeSpy).not.toHaveBeenCalled();
  expect(res3.claims).toHaveLength(0);
});
