import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { createBlackboard } from './blackboard.js';
import {
  availableControls,
  flattenState,
  runMachine,
  toRunStatus,
  type RunEvent,
} from './machine.js';

const board = () =>
  createBlackboard({
    runId: 'run_1',
    orgId: 'org_1',
    goal: 'Get pricing tiers',
    mode: 'BALANCED',
    budgetMicroUsd: 500_000,
    wallClockLimitMs: 900_000,
    startedAtMs: 0,
  });

function drive(events: RunEvent[]) {
  const actor = createActor(runMachine, { input: board() });
  actor.start();
  for (const event of events) actor.send(event);
  return actor;
}

const PLAN_READY: RunEvent = {
  type: 'PLAN_READY',
  planHash: 'abc',
  stepCount: 2,
  allowedHosts: ['ramp.com'],
};

const state = (actor: ReturnType<typeof drive>) => flattenState(actor.getSnapshot().value);

describe('planning and approval', () => {
  it('parks at awaitingApproval — the browser never starts before a human says go', () => {
    const actor = drive([{ type: 'START' }, PLAN_READY]);
    expect(state(actor)).toBe('awaitingApproval');
    expect(actor.getSnapshot().context.humanControl).toBe('awaiting_approval');
  });

  it('records the plan hash and allowed hosts on the blackboard', () => {
    const context = drive([{ type: 'START' }, PLAN_READY]).getSnapshot().context;
    expect(context.planHash).toBe('abc');
    expect(context.stepCount).toBe(2);
    expect(context.allowedHosts).toEqual(['ramp.com']);
  });

  it('stays at awaitingApproval when the plan is edited, rather than regenerating', () => {
    const actor = drive([{ type: 'START' }, PLAN_READY, { type: 'HUMAN_EDITED_PLAN' }]);
    expect(state(actor)).toBe('awaitingApproval');
  });

  it('starts executing only on explicit approval', () => {
    const actor = drive([{ type: 'START' }, PLAN_READY, { type: 'HUMAN_APPROVED_PLAN' }]);
    expect(state(actor)).toBe('executing.proposing');
    expect(actor.getSnapshot().context.humanControl).toBe('ai');
  });

  it('cancels on rejection', () => {
    const actor = drive([{ type: 'START' }, PLAN_READY, { type: 'HUMAN_REJECTED_PLAN' }]);
    expect(state(actor)).toBe('cancelled');
  });

  it('fails when planning fails', () => {
    expect(state(drive([{ type: 'START' }, { type: 'PLAN_FAILED' }]))).toBe('failed');
  });
});

const approved: RunEvent[] = [{ type: 'START' }, PLAN_READY, { type: 'HUMAN_APPROVED_PLAN' }];

describe('the action gate', () => {
  it('routes an ungated action straight to acting', () => {
    const actor = drive([...approved, { type: 'ACTION_PROPOSED', requiresApproval: false }]);
    expect(state(actor)).toBe('executing.acting');
  });

  it('blocks a gated action and marks the run as awaiting a human', () => {
    const actor = drive([...approved, { type: 'ACTION_PROPOSED', requiresApproval: true }]);
    expect(state(actor)).toBe('executing.gated');
    expect(actor.getSnapshot().context.humanControl).toBe('awaiting_approval');
  });

  it('does NOT act on any event other than a decision while gated', () => {
    // The bug this machine exists to prevent: "it paused, but then did one more click."
    const actor = drive([...approved, { type: 'ACTION_PROPOSED', requiresApproval: true }]);
    actor.send({ type: 'ACTION_EXECUTED' });
    actor.send({ type: 'CLAIMS_EXTRACTED' });
    expect(state(actor)).toBe('executing.gated');
  });

  it('proceeds on approval and skips on rejection', () => {
    expect(
      state(
        drive([
          ...approved,
          { type: 'ACTION_PROPOSED', requiresApproval: true },
          { type: 'HUMAN_APPROVED_ACTION' },
        ]),
      ),
    ).toBe('executing.acting');
    expect(
      state(
        drive([
          ...approved,
          { type: 'ACTION_PROPOSED', requiresApproval: true },
          { type: 'HUMAN_REJECTED_ACTION' },
        ]),
      ),
    ).toBe('executing.skipping');
  });

  it('lets a human take over from the gate', () => {
    const actor = drive([
      ...approved,
      { type: 'ACTION_PROPOSED', requiresApproval: true },
      { type: 'TAKEOVER' },
    ]);
    expect(state(actor)).toBe('takeover');
    expect(actor.getSnapshot().context.humanControl).toBe('human');
  });
});

describe('the step loop', () => {
  const throughOneStep: RunEvent[] = [
    ...approved,
    { type: 'ACTION_PROPOSED', requiresApproval: false },
    { type: 'ACTION_EXECUTED' },
    { type: 'CLAIMS_EXTRACTED' },
  ];

  it('advances to the next step while steps remain', () => {
    const actor = drive([...throughOneStep, { type: 'STEP_DONE' }]);
    expect(state(actor)).toBe('executing.proposing');
    expect(actor.getSnapshot().context.currentStepIndex).toBe(1);
  });

  it('moves to critique once every step is done', () => {
    const actor = drive([...throughOneStep, { type: 'STEP_DONE' }]);
    actor.send({ type: 'ACTION_PROPOSED', requiresApproval: false });
    actor.send({ type: 'ACTION_EXECUTED' });
    actor.send({ type: 'CLAIMS_EXTRACTED' });
    actor.send({ type: 'STEP_DONE' });
    expect(state(actor)).toBe('critique');
  });

  it('clears the action history when a step advances', () => {
    const actor = drive([...throughOneStep, { type: 'STEP_DONE' }]);
    expect(actor.getSnapshot().context.recentActions).toEqual([]);
  });

  it('runs critique before formatting, and never skips it', () => {
    const actor = drive([...throughOneStep, { type: 'STEP_DONE' }]);
    actor.send({ type: 'ACTION_PROPOSED', requiresApproval: false });
    actor.send({ type: 'ACTION_EXECUTED' });
    actor.send({ type: 'CLAIMS_EXTRACTED' });
    actor.send({ type: 'STEP_DONE' });
    actor.send({ type: 'FORMATTED' });
    expect(state(actor)).toBe('critique');
    actor.send({ type: 'CRITIQUE_DONE' });
    actor.send({ type: 'FORMATTED' });
    expect(state(actor)).toBe('completed');
  });
});

describe('recovery', () => {
  it('enters recovery on a failed action', () => {
    const actor = drive([
      ...approved,
      { type: 'ACTION_PROPOSED', requiresApproval: false },
      { type: 'ACTION_FAILED' },
    ]);
    expect(state(actor)).toBe('recovering');
  });

  it('returns to executing when a strategy is chosen', () => {
    const actor = drive([
      ...approved,
      { type: 'ACTION_PROPOSED', requiresApproval: false },
      { type: 'ACTION_FAILED' },
      { type: 'RECOVERY_CHOSEN' },
    ]);
    expect(state(actor)).toBe('executing.proposing');
  });

  it('escalates to a human — not to failure — when the ladder is exhausted', () => {
    const actor = drive([
      ...approved,
      { type: 'ACTION_PROPOSED', requiresApproval: false },
      { type: 'ACTION_FAILED' },
      { type: 'RECOVERY_EXHAUSTED' },
    ]);
    expect(state(actor)).toBe('takeover');
    expect(actor.getSnapshot().context.humanControl).toBe('human');
  });

  it('resumes at the same step after a takeover, not from the beginning', () => {
    const actor = drive([
      ...approved,
      { type: 'ACTION_PROPOSED', requiresApproval: false },
      { type: 'ACTION_FAILED' },
      { type: 'RECOVERY_EXHAUSTED' },
      { type: 'HUMAN_RETURNED' },
    ]);
    expect(state(actor)).toBe('executing.proposing');
    expect(actor.getSnapshot().context.currentStepIndex).toBe(0);
  });
});

describe('human control and budget', () => {
  it('pauses and resumes from anywhere in execution', () => {
    const actor = drive([...approved, { type: 'PAUSE' }]);
    expect(state(actor)).toBe('paused');
    actor.send({ type: 'RESUME' });
    expect(state(actor)).toBe('executing.proposing');
  });

  it('pauses rather than failing when the budget runs out', () => {
    const actor = drive([...approved, { type: 'BUDGET_EXCEEDED' }]);
    expect(state(actor)).toBe('paused');
    actor.send({ type: 'BUDGET_RAISED' });
    expect(state(actor)).toBe('executing.proposing');
  });

  it('stops from every non-terminal state', () => {
    expect(state(drive([...approved, { type: 'STOP' }]))).toBe('cancelled');
    expect(state(drive([{ type: 'START' }, PLAN_READY, { type: 'STOP' }]))).toBe('cancelled');
    expect(state(drive([...approved, { type: 'PAUSE' }, { type: 'STOP' }]))).toBe('cancelled');
  });

  it('ignores events once terminal', () => {
    const actor = drive([...approved, { type: 'STOP' }]);
    actor.send({ type: 'RESUME' });
    expect(state(actor)).toBe('cancelled');
  });
});

describe('projection onto RunStatus', () => {
  it('maps nested execution states onto the persisted status', () => {
    expect(toRunStatus('executing')).toBe('EXECUTING');
    expect(toRunStatus({ executing: 'gated' })).toBe('EXECUTING');
    expect(toRunStatus({ executing: 'verifying' })).toBe('VERIFYING');
    expect(toRunStatus('awaitingApproval')).toBe('AWAITING_APPROVAL');
    expect(toRunStatus('takeover')).toBe('TAKEOVER');
    expect(toRunStatus('completed')).toBe('COMPLETED');
  });
});

describe('availableControls', () => {
  it('derives the controls the interface should enable, with no second copy of the rules', () => {
    expect(availableControls('awaitingApproval')).toMatchObject({
      canApprovePlan: true,
      canPause: false,
      canApproveAction: false,
    });
    expect(availableControls({ executing: 'gated' })).toMatchObject({
      canApproveAction: true,
      canPause: true,
      canTakeover: true,
    });
    expect(availableControls('paused')).toMatchObject({ canResume: true, canPause: false });
    expect(availableControls('completed')).toMatchObject({
      isTerminal: true,
      canStop: false,
      canPause: false,
    });
  });
});
