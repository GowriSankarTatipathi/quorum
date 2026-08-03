import { PlanSchema, type Plan } from '@quorum/ai';
import { describe, expect, it } from 'vitest';
import { hashPlan, planRiskSummary } from './planner.js';

const step = (over: Partial<Plan['steps'][number]> = {}): Plan['steps'][number] => ({
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

const plan = (over: Partial<Plan> = {}): Plan =>
  PlanSchema.parse({
    summary: 'Collect monthly per-seat pricing from five vendors.',
    steps: [step()],
    allowedHosts: ['ramp.com'],
    totalEstimatedSeconds: 18,
    totalEstimatedUsd: 0.05,
    confidence: 0.9,
    refusal: null,
    ...over,
  });

describe('hashPlan', () => {
  it('is stable for the same plan', () => {
    expect(hashPlan(plan())).toBe(hashPlan(plan()));
  });

  it('changes when an objective changes, so an edited plan needs re-approval', () => {
    const edited = plan({ steps: [step({ objective: 'Extract pricing from brex.com instead' })] });
    expect(hashPlan(edited)).not.toBe(hashPlan(plan()));
  });

  it('changes when a target url changes — the exact edit the demo makes', () => {
    const edited = plan({ steps: [step({ targetUrl: 'https://airbase.io/pricing' })] });
    expect(hashPlan(edited)).not.toBe(hashPlan(plan()));
  });

  it('changes when risk changes, so a step becoming irreversible invalidates consent', () => {
    expect(hashPlan(plan({ steps: [step({ riskLevel: 'HIGH' })] }))).not.toBe(hashPlan(plan()));
  });

  it('ignores estimates, which drift without changing what was approved', () => {
    const reEstimated = plan({
      steps: [step({ estimatedSeconds: 25, estimatedUsd: 0.09 })],
      totalEstimatedSeconds: 25,
      totalEstimatedUsd: 0.09,
    });
    expect(hashPlan(reEstimated)).toBe(hashPlan(plan()));
  });

  it('is order-insensitive for allowedHosts but not for steps', () => {
    const a = plan({ allowedHosts: ['ramp.com', 'brex.com'] });
    const b = plan({ allowedHosts: ['brex.com', 'ramp.com'] });
    expect(hashPlan(a)).toBe(hashPlan(b));

    const twoSteps = plan({
      steps: [step(), step({ index: 1, objective: 'Extract pricing tiers from brex.com' })],
    });
    const swapped = plan({
      steps: [
        step({ objective: 'Extract pricing tiers from brex.com' }),
        step({ index: 1, objective: 'Extract pricing tiers from ramp.com' }),
      ],
    });
    expect(hashPlan(twoSteps)).not.toBe(hashPlan(swapped));
  });
});

describe('planRiskSummary', () => {
  it('reports LOW when nothing mutates state', () => {
    expect(planRiskSummary(plan())).toEqual({ highest: 'LOW', irreversibleSteps: [] });
  });

  it('surfaces the highest risk present, not the first', () => {
    const mixed = plan({
      steps: [
        step(),
        step({ index: 1, riskLevel: 'MEDIUM', objective: 'Extract pricing from brex.com' }),
        step({ index: 2, riskLevel: 'HIGH', objective: 'Request demo access on airbase.com' }),
      ],
    });
    const summary = planRiskSummary(mixed);
    expect(summary.highest).toBe('HIGH');
    // The plan-review screen names every step that will stop and ask, so the user does
    // not have to audit seven steps to work out whether anything is irreversible.
    expect(summary.irreversibleSteps).toEqual([2]);
  });

  it('lists every irreversible step, not just the first', () => {
    const twoHigh = plan({
      steps: [
        step({ riskLevel: 'HIGH', objective: 'Submit contact form on airbase.com' }),
        step({ index: 1, riskLevel: 'LOW', objective: 'Extract pricing from brex.com' }),
        step({ index: 2, riskLevel: 'HIGH', objective: 'Submit contact form on navan.com' }),
      ],
    });
    expect(planRiskSummary(twoHigh).irreversibleSteps).toEqual([0, 2]);
  });
});
