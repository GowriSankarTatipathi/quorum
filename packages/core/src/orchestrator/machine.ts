import { setup, type SnapshotFrom } from 'xstate';
import type { RunStatus } from '../enums.js';
import type { Blackboard } from './blackboard.js';

/**
 * Events the machine accepts. Human controls are events like any other — the person is a
 * participant on the same bus as the agents, not a special case threaded through the
 * runtime as a set of boolean flags.
 */
export type RunEvent =
  | { type: 'START' }
  | { type: 'PLAN_READY'; planHash: string; stepCount: number; allowedHosts: string[] }
  | { type: 'PLAN_FAILED' }
  | { type: 'HUMAN_APPROVED_PLAN' }
  | { type: 'HUMAN_EDITED_PLAN' }
  | { type: 'HUMAN_REJECTED_PLAN' }
  | { type: 'ACTION_PROPOSED'; requiresApproval: boolean }
  | { type: 'HUMAN_APPROVED_ACTION' }
  | { type: 'HUMAN_REJECTED_ACTION' }
  | { type: 'ACTION_EXECUTED' }
  | { type: 'ACTION_FAILED' }
  | { type: 'CLAIMS_EXTRACTED' }
  | { type: 'STEP_DONE' }
  | { type: 'RECOVERY_CHOSEN' }
  | { type: 'RECOVERY_EXHAUSTED' }
  | { type: 'CRITIQUE_DONE' }
  | { type: 'FORMATTED' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'TAKEOVER' }
  | { type: 'HUMAN_RETURNED' }
  | { type: 'BUDGET_EXCEEDED' }
  | { type: 'BUDGET_RAISED' }
  | { type: 'FAIL' };

/**
 * The run lifecycle, as an explicit state machine.
 *
 * Pause, resume, takeover and undo are *transitions*, not flags. Implemented as booleans
 * checked at ad-hoc points in a loop, they produce the bug that destroys trust in this
 * product — "it paused, but then did one more click". The machine is also serialisable,
 * so a worker can be evicted mid-run and a replacement can resume from the last
 * transition, and it is exported so the interface derives which controls are valid rather
 * than maintaining a second copy of the rules.
 */
export const runMachine = setup({
  /**
   * XState's documented idiom for declaring machine types. The assertion looks redundant
   * to the linter because the parameter accepts `{}`, but it is the only channel through
   * which the context and event types reach inference — removing it silently untypes
   * every guard and action below.
   */
  types: {
    context: {} as Blackboard,
    events: {} as RunEvent,
    input: {} as Blackboard,
  },
  guards: {
    /**
     * Is there a step AFTER the current one?
     *
     * The guard runs before `advanceStep`, so comparing the current index against the
     * count would advance past the last step and propose an action for a step that does
     * not exist — a run that looks like it is working and is addressing nothing.
     */
    hasStepsLeft: ({ context }) => context.currentStepIndex + 1 < context.stepCount,
    needsApproval: (_ctx, params: { requiresApproval: boolean }) => params.requiresApproval,
  },
  actions: {
    recordPlan: (
      { context },
      params: { planHash: string; stepCount: number; allowedHosts: string[] },
    ) => {
      context.planHash = params.planHash;
      context.stepCount = params.stepCount;
      context.allowedHosts = params.allowedHosts;
      context.version += 1;
    },
    advanceStep: ({ context }) => {
      context.currentStepIndex += 1;
      context.currentStepId = null;
      context.recentActions = [];
      context.version += 1;
    },
    markHumanDriving: ({ context }) => {
      context.humanControl = 'human';
      context.version += 1;
    },
    markAiDriving: ({ context }) => {
      context.humanControl = 'ai';
      context.version += 1;
    },
    markAwaitingApproval: ({ context }) => {
      context.humanControl = 'awaiting_approval';
      context.version += 1;
    },
  },
}).createMachine({
  id: 'run',
  initial: 'created',
  context: ({ input }) => input,
  states: {
    created: { on: { START: 'planning' } },

    planning: {
      on: {
        PLAN_READY: {
          target: 'awaitingApproval',
          actions: [{ type: 'recordPlan', params: ({ event }) => event }, 'markAwaitingApproval'],
        },
        PLAN_FAILED: 'failed',
        STOP: 'cancelled',
      },
    },

    awaitingApproval: {
      on: {
        HUMAN_APPROVED_PLAN: { target: 'executing', actions: 'markAiDriving' },
        // Editing keeps the run here: the plan is patched and re-approved, never
        // regenerated, so the parts the human already accepted survive.
        HUMAN_EDITED_PLAN: { target: 'awaitingApproval', reenter: false },
        HUMAN_REJECTED_PLAN: 'cancelled',
        STOP: 'cancelled',
      },
    },

    executing: {
      initial: 'proposing',
      states: {
        proposing: {
          on: {
            ACTION_PROPOSED: [
              {
                target: 'gated',
                guard: { type: 'needsApproval', params: ({ event }) => event },
                actions: 'markAwaitingApproval',
              },
              { target: 'acting' },
            ],
            ACTION_FAILED: '#run.recovering',
            STEP_DONE: [
              { target: 'proposing', guard: 'hasStepsLeft', actions: 'advanceStep', reenter: true },
              { target: '#run.critique' },
            ],
          },
        },
        gated: {
          on: {
            HUMAN_APPROVED_ACTION: { target: 'acting', actions: 'markAiDriving' },
            HUMAN_REJECTED_ACTION: { target: 'skipping', actions: 'markAiDriving' },
            TAKEOVER: '#run.takeover',
          },
        },
        acting: {
          on: {
            ACTION_EXECUTED: 'extracting',
            ACTION_FAILED: '#run.recovering',
          },
        },
        extracting: {
          on: {
            CLAIMS_EXTRACTED: 'verifying',
            ACTION_FAILED: '#run.recovering',
          },
        },
        verifying: {
          on: {
            STEP_DONE: [
              { target: 'proposing', guard: 'hasStepsLeft', actions: 'advanceStep', reenter: true },
              { target: '#run.critique' },
            ],
          },
        },
        skipping: {
          on: {
            STEP_DONE: [
              { target: 'proposing', guard: 'hasStepsLeft', actions: 'advanceStep', reenter: true },
              { target: '#run.critique' },
            ],
          },
        },
      },
      on: {
        PAUSE: '#run.paused',
        STOP: '#run.cancelled',
        TAKEOVER: '#run.takeover',
        BUDGET_EXCEEDED: '#run.paused',
      },
    },

    recovering: {
      on: {
        RECOVERY_CHOSEN: 'executing',
        // The terminal fallback of the recovery system is a human, not a failure. That
        // single edge is where "humans work with agents" stops being a slogan.
        RECOVERY_EXHAUSTED: { target: 'takeover', actions: 'markHumanDriving' },
        STOP: 'cancelled',
        PAUSE: 'paused',
      },
    },

    takeover: {
      entry: 'markHumanDriving',
      on: {
        HUMAN_RETURNED: { target: 'executing', actions: 'markAiDriving' },
        STOP: 'cancelled',
      },
    },

    paused: {
      on: {
        RESUME: { target: 'executing', actions: 'markAiDriving' },
        BUDGET_RAISED: { target: 'executing', actions: 'markAiDriving' },
        STOP: 'cancelled',
        TAKEOVER: 'takeover',
      },
    },

    critique: {
      on: { CRITIQUE_DONE: 'formatting', FAIL: 'failed', STOP: 'cancelled' },
    },

    formatting: {
      on: { FORMATTED: 'completed', FAIL: 'failed' },
    },

    completed: { type: 'final' },
    failed: { type: 'final' },
    cancelled: { type: 'final' },
  },
});

export type RunSnapshot = SnapshotFrom<typeof runMachine>;

/** Flatten a nested state value into a dotted path, e.g. `executing.gated`. */
export function flattenState(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const [key, child] = Object.entries(value)[0] ?? [];
    if (key === undefined) return 'unknown';
    return `${key}.${flattenState(child)}`;
  }
  return 'unknown';
}

/** Project a machine state onto the persisted `RunStatus`, which the UI and API speak. */
export function toRunStatus(stateValue: unknown): RunStatus {
  const flat = flattenState(stateValue);
  if (flat.startsWith('executing.verifying')) return 'VERIFYING';
  if (flat.startsWith('executing')) return 'EXECUTING';
  switch (flat) {
    case 'created':
      return 'CREATED';
    case 'planning':
      return 'PLANNING';
    case 'awaitingApproval':
      return 'AWAITING_APPROVAL';
    case 'recovering':
      return 'RECOVERING';
    case 'takeover':
      return 'TAKEOVER';
    case 'paused':
      return 'PAUSED';
    case 'critique':
      return 'CRITIQUE';
    case 'formatting':
      return 'FORMATTING';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'CREATED';
  }
}

/**
 * Which controls the interface should enable.
 *
 * Derived from the machine rather than hand-maintained, so the Pause button is disabled in
 * exactly the states where pausing is invalid — with no second copy of the rules to drift.
 */
export interface AvailableControls {
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  canTakeover: boolean;
  canApprovePlan: boolean;
  canApproveAction: boolean;
  isTerminal: boolean;
}

export function availableControls(stateValue: unknown): AvailableControls {
  const flat = flattenState(stateValue);
  const terminal = flat === 'completed' || flat === 'failed' || flat === 'cancelled';
  return {
    canPause: flat.startsWith('executing') || flat === 'recovering',
    canResume: flat === 'paused',
    canStop: !terminal && flat !== 'created',
    canTakeover: flat.startsWith('executing') || flat === 'paused' || flat === 'recovering',
    canApprovePlan: flat === 'awaitingApproval',
    canApproveAction: flat === 'executing.gated',
    isTerminal: terminal,
  };
}
