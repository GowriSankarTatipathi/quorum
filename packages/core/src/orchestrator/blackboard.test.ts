import { describe, expect, it } from 'vitest';
import { createBlackboard, rememberAction } from './blackboard.js';

const board = () =>
  createBlackboard({
    runId: 'run_1',
    orgId: 'org_1',
    goal: 'Get pricing tiers',
    mode: 'BALANCED',
    budgetMicroUsd: 500_000,
    wallClockLimitMs: 900_000,
    startedAtMs: 1_000,
  });

describe('blackboard', () => {
  it('is JSON-serialisable, which is what makes a run crash-resumable', () => {
    // Anything unserialisable here would silently break resume after a worker eviction.
    const round = JSON.parse(JSON.stringify(board())) as ReturnType<typeof board>;
    expect(round).toEqual(board());
  });

  it('starts with the AI driving and nothing spent', () => {
    const b = board();
    expect(b.humanControl).toBe('ai');
    expect(b.budget.spentMicroUsd).toBe(0);
    expect(b.claimIds).toEqual([]);
  });

  it('bounds the remembered action history so context cannot grow without limit', () => {
    let b = board();
    for (let i = 0; i < 12; i += 1) b = rememberAction(b, `action ${String(i)}`);
    expect(b.recentActions).toHaveLength(5);
    expect(b.recentActions.at(-1)).toBe('action 11');
  });

  it('bumps the version on every write, for optimistic concurrency', () => {
    const b = board();
    expect(rememberAction(b, 'x').version).toBe(b.version + 1);
  });
});
