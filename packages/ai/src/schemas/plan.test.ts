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
    const result = PlanSchema.safeParse(plan({ steps: [step({ agentPath: ['hacker'] })] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Invalid enum value/);
    }
  });

  it('normalises known synonyms like "extraction" to "reasoning"', () => {
    const result = PlanSchema.safeParse(
      plan({ steps: [step({ agentPath: ['browser', 'extraction'] })] }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps[0]?.agentPath).toEqual(['browser', 'reasoning']);
    }
  });

  it('allows canonical values to pass untouched', () => {
    const result = PlanSchema.safeParse(
      plan({ steps: [step({ agentPath: ['browser', 'reasoning'] })] }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps[0]?.agentPath).toEqual(['browser', 'reasoning']);
    }
  });

  it('rejects unknown synonyms like "summarizer"', () => {
    const result = PlanSchema.safeParse(
      plan({ steps: [step({ agentPath: ['browser', 'summarizer'] })] }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Invalid enum value/);
    }
  });

  it('normalises a nested JSON-Schema-shaped outputSchema to flat strings', () => {
    const nestedSchema = {
      tiers: { type: 'array', items: { name: 'string', price: 'number' } },
      metadata: { items: 'number', extra: 'string' },
    };
    const result = PlanSchema.safeParse(plan({ steps: [step({ outputSchema: nestedSchema })] }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps[0]?.outputSchema).toEqual({
        tiers: 'array',
        metadata: '{items,extra}',
      });
    }
  });

  it('allows a flat outputSchema map to pass through untouched', () => {
    const flatSchema = { plan_name: 'string', price_per_user_monthly: 'number|null' };
    const result = PlanSchema.safeParse(plan({ steps: [step({ outputSchema: flatSchema })] }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps[0]?.outputSchema).toEqual(flatSchema);
    }
  });

  it('rejects an outputSchema value that is neither string nor object', () => {
    const result = PlanSchema.safeParse(plan({ steps: [step({ outputSchema: { tiers: 123 } })] }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/Expected string, received number/);
    }
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
