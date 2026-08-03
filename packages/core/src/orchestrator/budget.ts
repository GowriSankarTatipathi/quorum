import type { BudgetState } from './blackboard.js';

export type BudgetVerdict =
  | { allow: true; warn: 'approaching_limit' | null }
  | { allow: false; reason: 'usd_limit' | 'wall_clock' };

/** Warn once spending crosses this share of the limit. */
const WARN_THRESHOLD = 0.8;

/**
 * Checked before every LLM call and every browser action.
 *
 * When the limit is reached the run PAUSES and asks rather than failing. Hard-failing at
 * 80% completion destroys work the user already paid for in order to enforce a limit they
 * would gladly have raised — and asking makes people comfortable setting *tighter*
 * defaults, which is better for everyone.
 */
export class BudgetGovernor {
  constructor(private readonly now: () => number = Date.now) {}

  check(budget: BudgetState, startedAtMs: number, projectedMicroUsd = 0): BudgetVerdict {
    if (this.now() - startedAtMs > budget.wallClockLimitMs) {
      return { allow: false, reason: 'wall_clock' };
    }

    const after = budget.spentMicroUsd + projectedMicroUsd;
    if (after > budget.limitMicroUsd) return { allow: false, reason: 'usd_limit' };
    if (after > budget.limitMicroUsd * WARN_THRESHOLD) {
      return { allow: true, warn: 'approaching_limit' };
    }
    return { allow: true, warn: null };
  }

  remainingMicroUsd(budget: BudgetState): number {
    return Math.max(0, budget.limitMicroUsd - budget.spentMicroUsd);
  }

  remainingUsd(budget: BudgetState): number {
    return this.remainingMicroUsd(budget) / 1_000_000;
  }

  /** The question put to the human, with enough context to answer it in one glance. */
  describeOverrun(budget: BudgetState, completedSteps: number, totalSteps: number): string {
    const spent = (budget.spentMicroUsd / 1_000_000).toFixed(2);
    const limit = (budget.limitMicroUsd / 1_000_000).toFixed(2);
    const progress =
      totalSteps > 0
        ? ` and is ${String(Math.round((completedSteps / totalSteps) * 100))}% complete`
        : '';
    return `This run has used its $${limit} budget (spent $${spent})${progress}. Raise the budget to continue, or stop here and keep what it has found.`;
  }

  raise(budget: BudgetState, additionalMicroUsd: number): BudgetState {
    return {
      ...budget,
      limitMicroUsd: budget.limitMicroUsd + additionalMicroUsd,
      raisedByHuman: true,
    };
  }
}
