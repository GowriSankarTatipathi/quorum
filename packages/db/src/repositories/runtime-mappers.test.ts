import { describe, expect, it } from 'vitest';
import { toClaim, toEvent, toLlmCall, toRun, toStep } from './runtime-mappers.js';

/**
 * Mappers are the one place where an untyped database row becomes a typed domain
 * record, so they are also the one place a schema change can silently produce garbage.
 * These fix the conversions that are easy to get wrong: Decimal, BigInt and null.
 */
describe('toRun', () => {
  const row = {
    id: 'run_1',
    userId: 'usr_1',
    orgId: 'org_1',
    recipeId: null,
    goal: 'Get pricing tiers',
    mode: 'BALANCED',
    status: 'EXECUTING',
    planHash: null,
    budgetUsd: { toString: () => '0.5000' },
    spentUsd: { toString: () => '0.0913' },
    inputTokens: 18_400,
    outputTokens: 2_100,
    browserSessionId: null,
    liveViewUrl: null,
    errorCode: null,
    errorDetail: null,
    startedAt: new Date('2026-08-02T10:00:00Z'),
    endedAt: null,
    createdAt: new Date('2026-08-02T09:59:00Z'),
    updatedAt: new Date('2026-08-02T10:01:00Z'),
  };

  it('converts Decimal money to exact integer micro-dollars', () => {
    const run = toRun(row);
    expect(run.budgetMicroUsd).toBe(500_000);
    expect(run.spentMicroUsd).toBe(91_300);
  });

  it('preserves nulls rather than coercing them to strings', () => {
    const run = toRun(row);
    expect(run.recipeId).toBeNull();
    expect(run.endedAt).toBeNull();
    expect(run.errorDetail).toBeNull();
  });
});

describe('toStep', () => {
  it('defaults an absent agentPath to an empty array, never undefined', () => {
    const step = toStep({
      id: 's1',
      runId: 'r1',
      index: 0,
      objective: 'Resolve pricing URLs',
      targetUrl: null,
      agentPath: null,
      outputSchema: null,
      riskLevel: 'LOW',
      notes: null,
      status: 'PENDING',
      estimatedMs: null,
      actualMs: null,
      estimatedUsd: null,
      attempt: 0,
      startedAt: null,
      endedAt: null,
      createdAt: new Date(),
    });
    expect(step.agentPath).toEqual([]);
    expect(step.estimatedMicroUsd).toBeNull();
  });

  it('converts an estimated cost when one is present', () => {
    const step = toStep({
      id: 's1',
      runId: 'r1',
      index: 1,
      objective: 'Extract',
      targetUrl: 'https://ramp.com/pricing',
      agentPath: ['browser', 'reasoning'],
      outputSchema: { plan: 'string' },
      riskLevel: 'MEDIUM',
      notes: 'Pricing may be gated',
      status: 'RUNNING',
      estimatedMs: 18_000,
      actualMs: null,
      estimatedUsd: '0.0500',
      attempt: 1,
      startedAt: new Date(),
      endedAt: null,
      createdAt: new Date(),
    });
    expect(step.estimatedMicroUsd).toBe(50_000);
    expect(step.agentPath).toEqual(['browser', 'reasoning']);
  });
});

describe('toClaim', () => {
  const base = {
    id: 'c1',
    stepId: 's1',
    entity: 'Ramp',
    field: 'price_per_user_monthly',
    unit: 'USD/user/month',
    sourceUrl: 'https://ramp.com/pricing',
    sourceSelector: null,
    sourceText: '$15 /user/month',
    screenshotKey: 'shots/1.jpg',
    domSnapshotKey: null,
    extractedAt: new Date(),
    extractedBy: 'claude-sonnet-4-5',
    promptVersion: 'reasoning.v4',
    confidence: '0.960',
    status: 'VERIFIED',
    ambiguity: null,
    nullReason: null,
    supersedesId: null,
    correctedBy: null,
  };

  it('reads DECIMAL(4,3) confidence', () => {
    expect(toClaim({ ...base, value: 15 }).confidence).toBeCloseTo(0.96, 10);
  });

  it('keeps a JSON null value distinct from a missing column', () => {
    const claim = toClaim({ ...base, value: null, nullReason: 'not_present' });
    expect(claim.value).toBeNull();
    expect(claim.nullReason).toBe('not_present');
  });

  it('carries the provenance needed to trace a number back to a pixel', () => {
    const claim = toClaim({ ...base, value: 15 });
    expect(claim.sourceUrl).toBe('https://ramp.com/pricing');
    expect(claim.sourceText).toBe('$15 /user/month');
    expect(claim.screenshotKey).toBe('shots/1.jpg');
    expect(claim.extractedBy).toBe('claude-sonnet-4-5');
    expect(claim.promptVersion).toBe('reasoning.v4');
  });
});

describe('toEvent', () => {
  it('converts BIGINT seq to a number so the event survives JSON.stringify', () => {
    const event = toEvent({
      id: '01J0',
      runId: 'r1',
      seq: 42n,
      type: 'claim.created',
      agent: 'reasoning',
      stepId: 's1',
      payload: { claimId: 'c1' },
      causationId: null,
      correlationId: null,
      ts: new Date(),
    });
    expect(event.seq).toBe(42);
    expect(typeof event.seq).toBe('number');
    expect(() => JSON.stringify(event)).not.toThrow();
  });
});

describe('toLlmCall', () => {
  it('converts sub-cent costs without losing precision', () => {
    const call = toLlmCall({
      id: 'l1',
      runId: 'r1',
      stepId: null,
      agent: 'verification',
      model: 'claude-haiku-4-5',
      promptVersion: 'verification.v2',
      inputTokens: 1_000,
      outputTokens: 200,
      cachedTokens: 0,
      costUsd: '0.002000',
      latencyMs: 410,
      cached: false,
      fallbackUsed: false,
      schemaViolation: false,
      createdAt: new Date(),
    });
    expect(call.costMicroUsd).toBe(2_000);
    expect(call.cached).toBe(false);
  });
});
