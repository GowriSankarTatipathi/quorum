import { describe, expect, it } from 'vitest';
import { PlanSchema } from './plan.js';

const step = (over: Record<string, unknown> = {}) => ({
  index: 0,
  objective: 'Extract pricing tiers from ramp.com',
  targetUrl: 'https://ramp.com/pricing',
  agentPath: ['browser', 'reasoning'],
  outputSchema: { plan: 'string', price_usd: 'number|null' },
  riskLevel: 'LOW',
  notes: null,
  estimatedSeconds: 18,
  estimatedUsd: 0.05,
  ...over,
});

const plan = (over: Record<string, unknown> = {}) => ({
  summary: 'Collect monthly per-seat pricing from five vendors.',
  steps: [step()],
  allowedHosts: ['ramp.com'],
  totalEstimatedSeconds: 18,
  totalEstimatedUsd: 0.05,
  confidence: 0.9,
  refusal: null,
  ...over,
});

describe('PlanSchema', () => {
  it('accepts a well-formed plan', () => {
    expect(PlanSchema.safeParse(plan()).success).toBe(true);
  });

  it('rejects a plan whose step indices are not dense and ordered', () => {
    // A gap would silently skip work while the run still reported completion.
    const result = PlanSchema.safeParse(plan({ steps: [step({ index: 1 })] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/must equal its position/);
    }
  });

  it('rejects an out-of-order pair of steps', () => {
    const result = PlanSchema.safeParse(
      plan({ steps: [step({ index: 1 }), step({ index: 0, objective: 'Second objective here' })] }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an agent that is not part of the pipeline', () => {
    expect(PlanSchema.safeParse(plan({ steps: [step({ agentPath: ['hacker'] })] })).success).toBe(
      false,
    );
  });

  it('rejects an empty plan, which must be expressed as a refusal instead', () => {
    expect(PlanSchema.safeParse(plan({ steps: [] })).success).toBe(false);
  });

  it('rejects a malformed target url rather than letting the browser resolve it', () => {
    expect(
      PlanSchema.safeParse(plan({ steps: [step({ targetUrl: 'ramp dot com' })] })).success,
    ).toBe(false);
  });

  it('allows a null target url for non-browsing steps', () => {
    expect(
      PlanSchema.safeParse(
        plan({ steps: [step({ targetUrl: null, agentPath: ['formatter'], outputSchema: null })] }),
      ).success,
    ).toBe(true);
  });

  it('rejects a confidence outside 0..1', () => {
    expect(PlanSchema.safeParse(plan({ confidence: 1.2 })).success).toBe(false);
  });

  it('caps plan length so a runaway planner cannot enqueue hundreds of steps', () => {
    const many = Array.from({ length: 31 }, (_, i) => step({ index: i }));
    expect(PlanSchema.safeParse(plan({ steps: many })).success).toBe(false);
  });
});
