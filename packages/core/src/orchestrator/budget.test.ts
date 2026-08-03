import { describe, expect, it } from 'vitest';
import { BudgetGovernor } from './budget.js';
import type { BudgetState } from './blackboard.js';

const budget = (over: Partial<BudgetState> = {}): BudgetState => ({
  limitMicroUsd: 500_000,
  spentMicroUsd: 0,
  wallClockLimitMs: 900_000,
  raisedByHuman: false,
  ...over,
});

describe('BudgetGovernor', () => {
  const governor = new BudgetGovernor(() => 1_000);

  it('allows spending well inside the limit', () => {
    expect(governor.check(budget(), 1_000, 50_000)).toEqual({ allow: true, warn: null });
  });

  it('warns before it refuses, so the interface can say something first', () => {
    expect(governor.check(budget({ spentMicroUsd: 300_000 }), 1_000, 150_000)).toEqual({
      allow: true,
      warn: 'approaching_limit',
    });
  });

  it('refuses a call that would exceed the limit, not one that already has', () => {
    // Checked against the projected cost, so the overrun never actually happens.
    expect(governor.check(budget({ spentMicroUsd: 450_000 }), 1_000, 100_000)).toEqual({
      allow: false,
      reason: 'usd_limit',
    });
  });

  it('refuses on wall-clock before it even considers money', () => {
    const late = new BudgetGovernor(() => 1_000_000);
    expect(late.check(budget(), 0, 1)).toEqual({ allow: false, reason: 'wall_clock' });
  });

  it('reports the remaining budget the Recovery agent is filtered against', () => {
    expect(governor.remainingUsd(budget({ spentMicroUsd: 400_000 }))).toBeCloseTo(0.1, 10);
  });

  it('never reports a negative remainder', () => {
    expect(governor.remainingMicroUsd(budget({ spentMicroUsd: 900_000 }))).toBe(0);
  });

  it('asks a question a person can answer in one glance', () => {
    const message = governor.describeOverrun(budget({ spentMicroUsd: 500_000 }), 4, 5);
    expect(message).toContain('$0.50');
    expect(message).toContain('80% complete');
    // Hard-failing at 80% would destroy work the user already paid for to enforce a limit
    // they would gladly have raised.
    expect(message).toContain('keep what it has found');
  });

  it('raises the limit and records that a human did it, so they are not asked twice', () => {
    const raised = governor.raise(budget({ spentMicroUsd: 500_000 }), 250_000);
    expect(raised.limitMicroUsd).toBe(750_000);
    expect(raised.raisedByHuman).toBe(true);
    expect(governor.check(raised, 1_000, 100_000).allow).toBe(true);
  });
});
