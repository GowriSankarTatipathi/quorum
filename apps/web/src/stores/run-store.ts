import type { AgentId, ClaimStatus, RunStatus } from '@quorum/core';
import { TRANSIENT_EVENTS } from '@quorum/events';
import { create } from 'zustand';

export interface StreamEvent {
  id: string;
  seq: number;
  type: string;
  agent: string | null;
  stepId: string | null;
  payload: unknown;
  causationId: string | null;
  correlationId: string | null;
  ts: string;
}

export type AgentState = 'idle' | 'running' | 'done' | 'failed';

export interface StepView {
  index: number;
  objective: string;
  targetUrl: string | null;
  riskLevel: string;
  notes: string | null;
  agentPath: string[];
  estimatedMs: number | null;
  estimatedUsd: number | null;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
}

export interface ClaimView {
  id: string;
  entity: string;
  field: string;
  value: unknown;
  unit: string | null;
  confidence: number | null;
  sourceUrl: string;
  status: ClaimStatus;
  independentReading?: unknown;
}

export interface CritiqueView {
  id: string;
  kind: string;
  severity: 'BLOCKING' | 'WARNING' | 'NOTE';
  message: string;
  claimIds: string[];
}

export interface PendingApproval {
  approvalId: string;
  trustLevel: number;
  reason: string;
  action: unknown;
  payload: Record<string, unknown> | null;
  screenshotKey: string | null;
}

export interface AgentTurn {
  correlationId: string;
  agent: AgentId;
  stepIndex: number | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  confidence: number | null;
  actions: { type: string; ok: boolean; durationMs: number | null }[];
  reasoning: string;
  model: string | null;
  costUsd: number;
  failed: boolean;
}

/** Bounded: 5,000 events at ~1 KB each is fine in memory, 50,000 is not. Older events are
 *  fetched on demand from the cursor endpoint, and the user never notices. */
const MAX_EVENTS = 2_000;

export interface RunStore {
  runId: string | null;
  status: RunStatus;
  connected: boolean;
  summaryMode: boolean;
  lastSeq: number;

  events: StreamEvent[];
  seenIds: Set<string>;

  steps: Map<number, StepView>;
  currentStepIndex: number;
  turns: AgentTurn[];
  agents: Record<AgentId, AgentState>;
  claims: Map<string, ClaimView>;
  critiques: CritiqueView[];

  frame: { url: string; capturedAt: number } | null;
  highlight: { x: number; y: number; width: number; height: number } | null;
  pageUrl: string | null;
  liveViewUrl: string | null;
  browserSessionState: 'not_started' | 'open' | 'closed';

  connectionState:
    'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'auth_failed';
  disconnectCode: number | null;
  disconnectReason: string | null;
  fallbackMode: boolean;

  pendingApproval: PendingApproval | null;
  humanQuestion: string | null;

  spentUsd: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: string | null;
  planHash: string | null;
  goal: string | null;

  reset: (runId: string) => void;
  setConnected: (connected: boolean) => void;
  setConnectionState: (
    state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'auth_failed',
    code?: number | null,
    reason?: string | null,
  ) => void;
  setFallbackMode: (on: boolean) => void;
  setSummaryMode: (on: boolean) => void;
  applyEvent: (event: StreamEvent) => void;
  applyBatch: (events: StreamEvent[]) => void;
  hydrateSteps: (steps: StepView[]) => void;
}

const IDLE_AGENTS: Record<AgentId, AgentState> = {
  planner: 'idle',
  browser: 'idle',
  reasoning: 'idle',
  verification: 'idle',
  critic: 'idle',
  recovery: 'idle',
  formatter: 'idle',
  human: 'idle',
};

const initial = {
  runId: null,
  status: 'CREATED' as RunStatus,
  connected: false,
  connectionState: 'idle' as const,
  disconnectCode: null,
  disconnectReason: null,
  fallbackMode: false,
  summaryMode: false,
  lastSeq: 0,
  events: [] as StreamEvent[],
  seenIds: new Set<string>(),
  steps: new Map<number, StepView>(),
  currentStepIndex: 0,
  turns: [] as AgentTurn[],
  agents: { ...IDLE_AGENTS },
  claims: new Map<string, ClaimView>(),
  critiques: [] as CritiqueView[],
  frame: null,
  highlight: null,
  pageUrl: null,
  liveViewUrl: null,
  browserSessionState: 'not_started' as const,
  pendingApproval: null,
  humanQuestion: null,
  spentUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  startedAt: null,
  planHash: null,
  goal: null,
};

type Draft = Omit<
  RunStore,
  | 'reset'
  | 'setConnected'
  | 'setConnectionState'
  | 'setFallbackMode'
  | 'setSummaryMode'
  | 'applyEvent'
  | 'applyBatch'
  | 'hydrateSteps'
>;

const payloadOf = <T>(event: StreamEvent): T => event.payload as T;

/**
 * The single reducer.
 *
 * Everything the interface shows is a projection of the event log — exactly as it is on
 * the server. That is what makes replay free: replaying is `applyBatch(historicalEvents)`
 * with a delay, running the identical code path. Building replay as a separate feature
 * would guarantee it drifts from live behaviour, and the entire value of an audit trail is
 * that the replay is faithful.
 */
export function reduceEvent(draft: Draft, event: StreamEvent): Draft {
  const next: Draft = { ...draft };

  switch (event.type) {
    case 'run.created': {
      const p = payloadOf<{ goal: string }>(event);
      next.status = 'CREATED';
      next.startedAt = event.ts;
      next.goal = p.goal;
      break;
    }
    case 'run.status.changed': {
      const p = payloadOf<{ to: RunStatus }>(event);
      next.status = p.to;
      break;
    }
    case 'run.completed':
      next.status = 'COMPLETED';
      break;
    case 'run.failed':
      next.status = 'FAILED';
      break;
    case 'run.cancelled':
      next.status = 'CANCELLED';
      break;
  }

  // A terminal run status must clear any lane still marked as running, and mark
  // the lane that failed as failed rather than pending.
  if (
    next.status !== draft.status &&
    (next.status === 'COMPLETED' || next.status === 'FAILED' || next.status === 'CANCELLED')
  ) {
    const agents = { ...next.agents };
    for (const [key, val] of Object.entries(agents)) {
      if (val === 'running') {
        agents[key as AgentId] = next.status === 'FAILED' ? 'failed' : 'idle';
      }
    }
    next.agents = agents;
  }

  switch (event.type) {
    case 'plan.step.proposed': {
      const p = payloadOf<StepView & { estimatedMs: number | null; estimatedUsd: number | null }>(
        event,
      );
      const steps = new Map(next.steps);
      steps.set(p.index, {
        index: p.index,
        objective: p.objective,
        targetUrl: p.targetUrl,
        riskLevel: p.riskLevel,
        notes: p.notes,
        agentPath: p.agentPath,
        estimatedMs: p.estimatedMs,
        estimatedUsd: p.estimatedUsd,
        status: 'PENDING',
      });
      next.steps = steps;
      break;
    }

    case 'plan.completed': {
      const p = payloadOf<{ planHash: string }>(event);
      next.planHash = p.planHash;
      break;
    }

    case 'agent.started': {
      const p = payloadOf<{ agent: AgentId; stepIndex: number | null }>(event);
      next.agents = { ...next.agents, [p.agent]: 'running' };
      next.turns = [
        ...next.turns,
        {
          correlationId: event.correlationId ?? event.id,
          agent: p.agent,
          stepIndex: p.stepIndex,
          startedAt: event.ts,
          finishedAt: null,
          durationMs: null,
          confidence: null,
          actions: [],
          reasoning: '',
          model: null,
          costUsd: 0,
          failed: false,
        },
      ];
      break;
    }
    case 'agent.finished': {
      const p = payloadOf<{ agent: AgentId; durationMs: number; confidence: number | null }>(event);
      next.agents = { ...next.agents, [p.agent]: 'done' };
      next.turns = updateTurn(next.turns, event.correlationId, (turn) => ({
        ...turn,
        finishedAt: event.ts,
        durationMs: p.durationMs,
        confidence: p.confidence,
      }));
      break;
    }
    case 'agent.failed': {
      const p = payloadOf<{ agent: AgentId }>(event);
      next.agents = { ...next.agents, [p.agent]: 'failed' };
      next.turns = updateTurn(next.turns, event.correlationId, (turn) => ({
        ...turn,
        failed: true,
      }));
      break;
    }

    case 'llm.token': {
      const p = payloadOf<{ text: string }>(event);
      next.turns = updateTurn(next.turns, event.correlationId, (turn) => ({
        ...turn,
        reasoning: turn.reasoning + p.text,
      }));
      break;
    }
    case 'llm.response': {
      const p = payloadOf<{
        model: string;
        cost: { usd: number; inputTokens: number; outputTokens: number };
      }>(event);
      next.spentUsd += p.cost.usd;
      next.inputTokens += p.cost.inputTokens;
      next.outputTokens += p.cost.outputTokens;
      next.turns = updateTurn(next.turns, event.correlationId, (turn) => ({
        ...turn,
        model: p.model,
        costUsd: turn.costUsd + p.cost.usd,
      }));
      break;
    }

    case 'browser.session.opened': {
      const p = payloadOf<{ liveViewUrl: string | null }>(event);
      next.browserSessionState = 'open';
      next.liveViewUrl = p.liveViewUrl;
      break;
    }
    case 'browser.navigate': {
      const p = payloadOf<{ url: string }>(event);
      next.pageUrl = p.url;
      next.highlight = null;
      break;
    }
    case 'browser.action.start': {
      const p = payloadOf<{
        action: { type: string };
        highlight: { x: number; y: number; width: number; height: number } | null;
      }>(event);
      // Drawn before the action runs, so the user can predict intent — and hit pause
      // before a bad click rather than after it.
      next.highlight = p.highlight;
      next.turns = updateTurn(next.turns, event.correlationId, (turn) => ({
        ...turn,
        actions: [...turn.actions, { type: p.action.type, ok: false, durationMs: null }],
      }));
      break;
    }
    case 'browser.action.ok': {
      const p = payloadOf<{ durationMs: number }>(event);
      next.highlight = null;
      next.turns = updateTurn(next.turns, event.correlationId, (turn) => ({
        ...turn,
        actions: turn.actions.map((action, i) =>
          i === turn.actions.length - 1
            ? { ...action, ok: true, durationMs: p.durationMs }
            : action,
        ),
      }));
      break;
    }
    case 'browser.action.failed':
      next.highlight = null;
      break;
    case 'browser.screenshot': {
      const p = payloadOf<{ url: string }>(event);
      next.frame = { url: p.url, capturedAt: new Date(event.ts).getTime() };
      break;
    }
    case 'browser.session.closed': {
      const p = payloadOf<{ finalFrameUrl?: string }>(event);
      next.browserSessionState = 'closed';
      next.liveViewUrl = null;
      if (p.finalFrameUrl) {
        next.frame = { url: p.finalFrameUrl, capturedAt: new Date(event.ts).getTime() };
      }
      break;
    }

    case 'claim.created': {
      const p = payloadOf<Omit<ClaimView, 'id' | 'status'> & { claimId: string }>(event);
      const claims = new Map(next.claims);
      claims.set(p.claimId, {
        id: p.claimId,
        entity: p.entity,
        field: p.field,
        value: p.value,
        unit: p.unit,
        confidence: p.confidence,
        sourceUrl: p.sourceUrl,
        status: 'UNVERIFIED',
      });
      next.claims = claims;
      break;
    }
    case 'claim.verified': {
      const p = payloadOf<{ claimId: string }>(event);
      next.claims = withClaim(next.claims, p.claimId, (claim) => ({
        ...claim,
        status: 'VERIFIED',
      }));
      break;
    }
    case 'claim.contradicted': {
      const p = payloadOf<{ claimId: string; verdict?: ClaimStatus; independentReading?: unknown }>(
        event,
      );
      next.claims = withClaim(next.claims, p.claimId, (claim) => ({
        ...claim,
        status: p.verdict ?? 'CONTRADICTED',
        independentReading: p.independentReading,
      }));
      break;
    }
    case 'claim.superseded': {
      const p = payloadOf<{ claimId: string }>(event);
      next.claims = withClaim(next.claims, p.claimId, (claim) => ({
        ...claim,
        status: 'SUPERSEDED',
      }));
      break;
    }

    case 'critique.raised': {
      const p = payloadOf<CritiqueView & { critiqueId: string }>(event);
      next.critiques = [
        ...next.critiques,
        {
          id: p.critiqueId,
          kind: p.kind,
          severity: p.severity,
          message: p.message,
          claimIds: p.claimIds,
        },
      ];
      break;
    }

    case 'approval.requested':
      next.pendingApproval = payloadOf<PendingApproval>(event);
      break;
    case 'approval.granted':
    case 'approval.rejected':
    case 'approval.timeout':
      if (next.pendingApproval?.approvalId === payloadOf<{ approvalId: string }>(event).approvalId)
        next.pendingApproval = null;
      break;

    case 'human.takeover.started': {
      const p = payloadOf<{ reason: string }>(event);
      next.humanQuestion = p.reason;
      break;
    }
    case 'human.takeover.ended':
      next.humanQuestion = null;
      break;

    default:
      break;
  }

  // A terminal run status must clear any lane still marked as running, and mark
  // the lane that failed as failed rather than pending.
  if (
    next.status !== draft.status &&
    (next.status === 'COMPLETED' || next.status === 'FAILED' || next.status === 'CANCELLED')
  ) {
    const agents = { ...next.agents };
    for (const [key, val] of Object.entries(agents)) {
      if (val === 'running') {
        agents[key as AgentId] = next.status === 'FAILED' ? 'failed' : 'idle';
      }
    }
    next.agents = agents;
  }

  if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(next.status)) next.pendingApproval = null;
  return next;
}

function updateTurn(
  turns: AgentTurn[],
  correlationId: string | null,
  update: (turn: AgentTurn) => AgentTurn,
): AgentTurn[] {
  if (!correlationId) return turns;
  // Search from the end: the turn being updated is nearly always the newest one.
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i]!.correlationId === correlationId) {
      const copy = [...turns];
      copy[i] = update(turns[i]!);
      return copy;
    }
  }
  return turns;
}

function withClaim(
  claims: Map<string, ClaimView>,
  id: string,
  update: (claim: ClaimView) => ClaimView,
): Map<string, ClaimView> {
  const existing = claims.get(id);
  if (!existing) return claims;
  const copy = new Map(claims);
  copy.set(id, update(existing));
  return copy;
}

export const useRunStore = create<RunStore>((set) => ({
  ...initial,

  reset: (runId) => {
    set((state) => ({
      ...initial,
      runId,
      seenIds: new Set(),
      steps: new Map(),
      claims: new Map(),
      // The socket is not part of the run projection. Re-seeding the store must not
      // report a live stream as idle, which is what made the viewport claim the run
      // was not connected while frames were arriving.
      connectionState: state.connectionState,
      disconnectCode: state.disconnectCode,
      disconnectReason: state.disconnectReason,
    }));
  },
  setConnected: (connected) => {
    set({ connected });
  },
  setConnectionState: (state, code = null, reason = null) => {
    set({ connectionState: state, disconnectCode: code, disconnectReason: reason });
  },
  setFallbackMode: (on) => {
    set({ fallbackMode: on });
  },
  setSummaryMode: (summaryMode) => {
    set({ summaryMode });
  },

  applyEvent: (event) => {
    set((state) => applyOne(state, event));
  },

  applyBatch: (events) => {
    set((state) => {
      let next = state;
      const finalDiff: Partial<RunStore> = {};
      for (const event of events) {
        const diff = applyOne(next, event);
        next = { ...next, ...diff };
        Object.assign(finalDiff, diff);
      }
      return finalDiff;
    });
  },

  hydrateSteps: (steps) => {
    set(() => ({ steps: new Map(steps.map((step) => [step.index, step])) }));
  },
}));

/** Idempotent by event id: a reconnect overlap replays events the client already has. */
function applyOne(state: RunStore, event: StreamEvent): Partial<RunStore> {
  if (state.seenIds.has(event.id)) return {};

  const seenIds = new Set(state.seenIds);
  seenIds.add(event.id);

  const events = (TRANSIENT_EVENTS as unknown as Set<string>).has(event.type)
    ? state.events
    : [...state.events, event].slice(-MAX_EVENTS);

  const projected = reduceEvent(state, event);

  const diff: Partial<RunStore> = {};
  const proj = projected as unknown as RunStore;
  for (const k of Object.keys(projected) as Array<keyof RunStore>) {
    if (proj[k] !== state[k]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
      diff[k] = proj[k] as any;
    }
  }

  return {
    ...diff,
    events,
    seenIds,
    lastSeq: Math.max(state.lastSeq, event.seq),
  };
}
