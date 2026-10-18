import type {
  AgentId,
  ClaimStatus,
  CritiqueKind,
  RunStatus,
  Severity,
  TrustLevel,
} from '@quorum/core';

/**
 * The complete event taxonomy. Namespaced `domain.subject.verb`.
 *
 * This union is the contract between the worker (producer), the gateway (relay), the
 * database (audit trail) and the UI (projection). Because the client's view is a pure
 * projection of this log, live streaming and replay run through identical code.
 */
export const RUN_EVENT_TYPES = [
  'run.created',
  'run.planning.started',
  'run.status.changed',
  'run.completed',
  'run.failed',
  'run.cancelled',

  'plan.step.proposed',
  'plan.completed',
  'plan.patched',
  'plan.approved',

  'agent.started',
  'agent.finished',
  'agent.failed',
  'agent.handoff',

  'llm.request',
  'llm.token',
  'llm.response',
  'llm.schema_violation',
  'llm.provider_failed',
  'llm.fallback_used',
  'llm.cache_hit',

  'browser.session.opened',
  'browser.navigate',
  'browser.action.start',
  'browser.action.ok',
  'browser.action.failed',
  'browser.screenshot',
  'browser.dom.snapshot',
  'browser.noop_detected',
  'browser.session.closed',

  'claim.created',
  'claim.verified',
  'claim.contradicted',
  'claim.superseded',
  'claim.corrected',

  'critique.raised',
  'critique.resolved',

  'error.classified',
  'recovery.started',
  'recovery.strategy.chosen',
  'recovery.succeeded',
  'recovery.exhausted',

  'approval.requested',
  'approval.granted',
  'approval.rejected',
  'approval.timeout',

  'human.paused',
  'human.resumed',
  'human.stopped',
  'human.takeover.started',
  'human.takeover.ended',
  'human.undo',
  'human.plan.edited',

  'budget.warning',
  'budget.exceeded',

  'pagination.loop_detected',
  'pagination.exhausted',
  'pagination.capped',

  'security.injection_detected',
  'security.domain_blocked',
  'security.robots_disallowed',
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/**
 * Event types that are broadcast for live telemetry but MUST NOT be persisted to the database.
 */
export const TRANSIENT_EVENTS = new Set<RunEventType>(['browser.screenshot']);

export interface CostFragment {
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

/**
 * Payload shape for every event type. `Record<RunEventType, ...>` makes adding an
 * event type without a payload definition a compile error.
 */
export interface RunEventPayloads extends Record<RunEventType, unknown> {
  'run.created': { goal: string; mode: string; budgetUsd: number };
  'run.planning.started': { goal: string };
  'run.status.changed': { from: RunStatus; to: RunStatus };
  'run.completed': {
    claimCount: number;
    verifiedCount: number;
    costUsd: number;
    durationMs: number;
  };
  'run.failed': { code: string; humanMessage: string };
  'run.cancelled': { by: 'human' | 'system'; reason: string };

  'plan.step.proposed': {
    index: number;
    objective: string;
    targetUrl: string | null;
    riskLevel: string;
    agentPath: string[];
    estimatedMs: number | null;
    estimatedUsd: number | null;
    notes: string | null;
  };
  'plan.completed': { stepCount: number; totalEstimatedUsd: number; planHash: string };
  'plan.patched': { stepIndex: number; field: string; before: unknown; after: unknown };
  'plan.approved': { planHash: string; approvedBy: string };

  'agent.started': { agent: AgentId; stepIndex: number | null };
  'agent.finished': { agent: AgentId; durationMs: number; confidence: number | null };
  'agent.failed': { agent: AgentId; code: string };
  'agent.handoff': { from: AgentId; to: AgentId };

  'llm.request': { agent: AgentId; model: string; promptVersion: string; inputTokens: number };
  'llm.token': { agent: AgentId; text: string };
  'llm.response': {
    agent: AgentId;
    model: string;
    latencyMs: number;
    cost: CostFragment;
    cached: boolean;
  };
  'llm.schema_violation': { agent: AgentId; model: string; issues: string[] };
  'llm.provider_failed': { agent: AgentId; model: string; error: string };
  'llm.fallback_used': { agent: AgentId; from: string; to: string; reason: string };
  'llm.cache_hit': { agent: AgentId; savedUsd: number };

  'browser.session.opened': { sessionId: string; driver: string; liveViewUrl: string | null };
  'browser.navigate': { url: string; title: string | null };
  'browser.action.start': {
    action: { type: string; ref?: number };
    trustLevel: TrustLevel;
    highlight: { x: number; y: number; width: number; height: number } | null;
  };
  'browser.action.ok': { action: { type: string }; durationMs: number; changed: boolean };
  'browser.action.failed': { action: { type: string }; code: string; humanMessage: string };
  'browser.screenshot': { key: string; url: string; width: number; height: number };
  'browser.dom.snapshot': { key: string; contentHash: string; nodeCount: number };
  'browser.noop_detected': { action: { type: string }; ref: number | null };
  'browser.session.closed': {
    sessionId: string;
    durationMs: number;
    finalFrameUrl?: string;
    finalFrameKey?: string;
  };

  'claim.created': {
    claimId: string;
    entity: string;
    field: string;
    value: unknown;
    unit: string | null;
    confidence: number | null;
    sourceUrl: string;
  };
  'claim.verified': { claimId: string; verdict: ClaimStatus; confidence: number | null };
  'claim.contradicted': {
    claimId: string;
    claimed: unknown;
    independentReading: unknown;
    verdict?: ClaimStatus;
    rationale?: string;
  };
  'claim.superseded': { claimId: string; supersededBy: string; reason: string };
  'claim.corrected': { claimId: string; newClaimId: string; correctedBy: string };

  'critique.raised': {
    critiqueId: string;
    kind: CritiqueKind;
    severity: Severity;
    message: string;
    claimIds: string[];
  };
  'critique.resolved': { critiqueId: string; resolution: string; resolvedBy: string };

  'error.classified': {
    errorClass: string;
    code: string;
    humanMessage: string;
    retryable: boolean;
    requiresHuman: boolean;
  };
  'recovery.started': { errorCode: string; attempt: number };
  'recovery.strategy.chosen': { strategy: string; rationale: string; expectedOutcome: string };
  'recovery.succeeded': { strategy: string; attempts: number };
  'recovery.exhausted': { attempts: number; escalatingTo: 'human' | 'skip' };

  'approval.requested': {
    approvalId: string;
    trustLevel: TrustLevel;
    reason: string;
    action: unknown;
    payload: unknown;
    screenshotKey: string | null;
  };
  'approval.granted': { approvalId: string; by: string; edited: boolean; scope: string };
  'approval.rejected': { approvalId: string; by: string };
  'approval.timeout': { approvalId: string; waitedMs: number };

  'human.paused': { by: string };
  'human.resumed': { by: string };
  'human.stopped': { by: string };
  'human.takeover.started': { by: string; reason: string };
  'human.takeover.ended': { by: string; observedChanges: string[] };
  'human.undo': { stepId: string; ok: boolean; reason: string | null };
  'human.plan.edited': { stepIndex: number; by: string };

  'budget.warning': { spentUsd: number; limitUsd: number };
  'budget.exceeded': { spentUsd: number; limitUsd: number };

  'pagination.loop_detected': { page: number };
  'pagination.exhausted': { pages: number };
  'pagination.capped': { max: number };

  'security.injection_detected': { excerpt: string; url: string };
  'security.domain_blocked': { url: string; allowedHosts: string[] };
  'security.robots_disallowed': { url: string };
}

/** A single, fully-typed event. `seq` is a monotonic per-run cursor for reconnect. */
export interface RunEvent<T extends RunEventType = RunEventType> {
  id: string;
  runId: string;
  seq: number;
  type: T;
  agent: AgentId | null;
  stepId: string | null;
  payload: RunEventPayloads[T];
  causationId: string | null;
  correlationId: string | null;
  ts: string;
}

export type AnyRunEvent = { [K in RunEventType]: RunEvent<K> }[RunEventType];
