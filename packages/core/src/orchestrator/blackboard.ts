import type { AutonomyMode } from '../enums.js';
import type { ClassifiedError } from '../errors/taxonomy.js';
import type { RecoveryStrategy } from '../errors/ladder.js';

/**
 * Shared state for a run.
 *
 * Agents read what they need and write only their own namespace. Serialisable by
 * construction — no class instances, no functions, no Dates — because it is persisted on
 * every state transition so a replacement worker can resume a run an evicted one was
 * holding. Anything unserialisable here would silently break crash recovery.
 */
export interface Blackboard {
  runId: string;
  orgId: string;
  version: number;

  goal: string;
  mode: AutonomyMode;

  planHash: string | null;
  allowedHosts: string[];

  stepCount: number;
  currentStepIndex: number;
  currentStepId: string | null;

  sessionId: string | null;
  currentUrl: string | null;
  lastContentHash: string | null;
  /** The last few actions, so the Browser agent can tell it is repeating itself. */
  recentActions: string[];

  claimIds: string[];
  quarantinedCount: number;

  lastError: ClassifiedError | null;
  recoveryAttempts: { stepId: string; strategy: RecoveryStrategy; succeeded: boolean | null }[];

  budget: BudgetState;
  humanControl: HumanControl;
  startedAtMs: number;
}

export type HumanControl = 'ai' | 'human' | 'awaiting_approval';

export interface BudgetState {
  limitMicroUsd: number;
  spentMicroUsd: number;
  wallClockLimitMs: number;
  /** Set once the user has raised the limit, so they are not asked twice. */
  raisedByHuman: boolean;
}

export function createBlackboard(input: {
  runId: string;
  orgId: string;
  goal: string;
  mode: AutonomyMode;
  budgetMicroUsd: number;
  wallClockLimitMs: number;
  startedAtMs: number;
}): Blackboard {
  return {
    runId: input.runId,
    orgId: input.orgId,
    version: 1,
    goal: input.goal,
    mode: input.mode,
    planHash: null,
    allowedHosts: [],
    stepCount: 0,
    currentStepIndex: 0,
    currentStepId: null,
    sessionId: null,
    currentUrl: null,
    lastContentHash: null,
    recentActions: [],
    claimIds: [],
    quarantinedCount: 0,
    lastError: null,
    recoveryAttempts: [],
    budget: {
      limitMicroUsd: input.budgetMicroUsd,
      spentMicroUsd: 0,
      wallClockLimitMs: input.wallClockLimitMs,
      raisedByHuman: false,
    },
    humanControl: 'ai',
    startedAtMs: input.startedAtMs,
  };
}

/** Bounded so a long run's context does not grow without limit. */
const RECENT_ACTIONS_KEPT = 5;

export function rememberAction(board: Blackboard, description: string): Blackboard {
  return {
    ...board,
    version: board.version + 1,
    recentActions: [...board.recentActions, description].slice(-RECENT_ACTIONS_KEPT),
  };
}
