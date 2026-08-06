import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runReasoningAgent } from './reasoning.js';
import { claimRepository, type ClaimRecord, type CreateClaimInput } from '@quorum/db';
import { LlmRouter, ZERO_COST, type AgentCallInput, type AgentCallResult } from '@quorum/ai';
import * as llm from '../services/llm.js';
import type { ZodTypeAny, output as ZodOutput } from 'zod';
import { randomUUID } from 'node:crypto';

vi.mock('../services/event-publisher.js', () => ({
  eventPublisher: {
    emit: () => Promise.resolve(),
  },
}));

vi.mock('../logger.js', () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));

const FIXTURE_TEXT = `Pricing
Billing period
monthly
annual −20%
Starter
$0
1 seat / month
Expense capture
CSV export
Collect
$8
per user / month
Everything in Starter
Approvals
Receipt matching
Control
$18
per user / month
Everything in Collect
SSO
Audit trail
Enterprise
Custom
contact sales
Everything in Control
Dedicated support`;

describe('Reasoning Agent Deduplication (Integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs three steps over the fixture and yields exactly one claim per entity+field without dropping coverage', async () => {
    let stepCount = 0;

    const fakeRouter = Object.create(LlmRouter.prototype) as LlmRouter;
    Object.defineProperty(fakeRouter, 'candidates', { get: () => ({ reasoning: ['claude-sonnet-4-5-20250929'] }) });
    fakeRouter.call = <S extends ZodTypeAny>(_input: AgentCallInput, _schema: S): Promise<AgentCallResult<ZodOutput<S>>> => {
      stepCount++;
      let claims: Record<string, unknown>[] = [];
      
      if (stepCount === 1) {
        claims = [
          { entity: 'Starter', field: 'plan_name', value: 'Starter', sourceText: 'Starter', confidence: 0.9, ambiguity: null, nullReason: null },
          { entity: 'Collect', field: 'plan_name', value: 'Collect', sourceText: 'Collect', confidence: 0.9, ambiguity: null, nullReason: null },
          { entity: 'Control', field: 'plan_name', value: 'Control', sourceText: 'Control', confidence: 0.9, ambiguity: null, nullReason: null },
          { entity: 'Enterprise', field: 'plan_name', value: 'Enterprise', sourceText: 'Enterprise', confidence: 0.9, ambiguity: null, nullReason: null },
          { entity: 'Starter', field: 'price', value: 0, sourceText: '$0', unit: 'USD', confidence: 0.9, ambiguity: null, nullReason: null }
        ];
      } else if (stepCount === 2) {
        claims = [
          { entity: 'Collect', field: 'price', value: 8, sourceText: '$8', unit: 'USD', confidence: 0.9, ambiguity: null, nullReason: null },
          { entity: 'Control', field: 'price', value: 18, sourceText: '$18', unit: 'USD', confidence: 0.9, ambiguity: null, nullReason: null }
        ];
      } else if (stepCount === 3) {
        claims = [
          { entity: 'Enterprise', field: 'price', value: null, sourceText: null, unit: null, confidence: null, ambiguity: null, nullReason: 'not_present' }
        ];
      }

      return Promise.resolve({
        model: 'claude-sonnet-4-5-20250929', cost: ZERO_COST, latencyMs: 10, cached: false, fallbackUsed: false, raw: '',
        data: { claims, note: null, injectionDetected: false, injectionExcerpt: null } as ZodOutput<S>,
      });
    };

    vi.spyOn(llm, 'createRouter').mockReturnValue(fakeRouter);

    const claimsStore: ClaimRecord[] = [];

    vi.spyOn(claimRepository, 'create').mockImplementation((claim: CreateClaimInput): Promise<ClaimRecord> => {
      const record = {
        ...claim,
        id: randomUUID(),
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
      } as ClaimRecord;
      claimsStore.push(record);
      return Promise.resolve(record);
    });

    vi.spyOn(claimRepository, 'supersede').mockImplementation((_id: string, claim: CreateClaimInput): Promise<ClaimRecord> => {
      const record = {
        ...claim,
        id: randomUUID(),
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
      } as ClaimRecord;
      
      const idx = claimsStore.findIndex(c => c.id === _id);
      if (idx === -1) {
        throw new Error(`Attempted to supersede claim ${_id} but it was not found in store`);
      }
      
      const existingClaim = claimsStore[idx];
      if (existingClaim) {
        existingClaim.status = 'SUPERSEDED';
      }
      
      claimsStore.push(record);
      
      return Promise.resolve(record);
    });

    const runOpts = {
      runId: 'r1',
      stepObjective: 'Get the monthly price per user for every tier and the plan name.',
      outputSchema: { plan_name: 'string', price: 'number' },
      url: 'http://localhost:8080/pricing',
      pageContent: FIXTURE_TEXT,
      capturedText: FIXTURE_TEXT,
      screenshotKey: null,
      domSnapshotKey: null,
    };

    // Step 1
    await runReasoningAgent({
      ...runOpts,
      stepId: 's1',
      correlationId: 'c1',
      existingClaims: claimsStore,
    });

    // Step 2
    await runReasoningAgent({
      ...runOpts,
      stepId: 's2',
      correlationId: 'c2',
      existingClaims: claimsStore,
    });

    // Step 3
    await runReasoningAgent({
      ...runOpts,
      stepId: 's3',
      correlationId: 'c3',
      existingClaims: claimsStore,
    });

    // Filter to active claims
    const activeClaims = claimsStore.filter(c => c.status !== 'SUPERSEDED');
    
    // We expect exactly 4 plan_names and exactly 4 prices (Enterprise is null).
    const planNames = activeClaims.filter(c => c.field === 'plan_name');
    const prices = activeClaims.filter(c => c.field === 'price');

    expect(planNames).toHaveLength(4);
    expect(planNames.map(c => c.entity).sort()).toEqual(['Collect', 'Control', 'Enterprise', 'Starter']);

    expect(prices).toHaveLength(4);
    expect(prices.map(c => c.entity).sort()).toEqual(['Collect', 'Control', 'Enterprise', 'Starter']);

    const enterprisePrice = prices.find(c => c.entity === 'Enterprise');
    expect(enterprisePrice!.value).toBeNull();
    expect(enterprisePrice!.nullReason).toBe('not_present');

    const collectPrice = prices.find(c => c.entity === 'Collect');
    expect(collectPrice!.value).toBe(8); // or whatever the model extracts for monthly
  }, 60000);
});
