import type {
  AutonomyMode,
  ClaimStatus,
  CritiqueKind,
  RiskLevel,
  RunStatus,
  Severity,
  StepStatus,
} from '@quorum/core';
import { decimalToConfidence, decimalToMicroUsd } from '../money.js';
import type {
  ApprovalRecord,
  ApprovalScope,
  ApprovalStatus,
  ArtifactKind,
  ArtifactRecord,
  ClaimRecord,
  CritiqueRecord,
  CritiqueResolution,
  EventRecord,
  LlmCallRecord,
  RecipeRecord,
  RecoveryAttemptRecord,
  RunRecord,
  RunSnapshot,
  ShareLinkRecord,
  StepRecord,
  UndoFrameRecord,
  VerdictRecord,
} from '../types.js';

/**
 * Prisma rows are `any` until `prisma generate` runs, so every conversion from a row to
 * a domain record happens here. Two payoffs: the type-unsafe surface is one auditable
 * file, and `Decimal` becomes integer micro-dollars at exactly one boundary instead of
 * being re-derived (differently) at each call site.
 */
type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : str(v));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const bool = (v: unknown): boolean => v === true;
const boolOrNull = (v: unknown): boolean | null => (v == null ? null : v === true);
const date = (v: unknown): Date => (v instanceof Date ? v : new Date(str(v)));
const dateOrNull = (v: unknown): Date | null => (v == null ? null : date(v));
const json = (v: unknown): Record<string, unknown> | null =>
  v == null ? null : (v as Record<string, unknown>);
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

export function toRun(row: Row): RunRecord {
  return {
    id: str(row.id),
    userId: str(row.userId),
    orgId: str(row.orgId),
    recipeId: strOrNull(row.recipeId),
    goal: str(row.goal),
    mode: str(row.mode) as AutonomyMode,
    status: str(row.status) as RunStatus,
    planHash: strOrNull(row.planHash),
    budgetMicroUsd: decimalToMicroUsd(row.budgetUsd),
    spentMicroUsd: decimalToMicroUsd(row.spentUsd),
    inputTokens: num(row.inputTokens),
    outputTokens: num(row.outputTokens),
    browserSessionId: strOrNull(row.browserSessionId),
    liveViewUrl: strOrNull(row.liveViewUrl),
    errorCode: strOrNull(row.errorCode),
    errorDetail: json(row.errorDetail),
    startedAt: dateOrNull(row.startedAt),
    endedAt: dateOrNull(row.endedAt),
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
  };
}

export function toRunSnapshot(row: Row): RunSnapshot {
  return { machineState: json(row.machineState), blackboard: json(row.blackboard) };
}

export function toStep(row: Row): StepRecord {
  return {
    id: str(row.id),
    runId: str(row.runId),
    index: num(row.index),
    objective: str(row.objective),
    targetUrl: strOrNull(row.targetUrl),
    agentPath: strArray(row.agentPath),
    outputSchema: json(row.outputSchema),
    riskLevel: str(row.riskLevel) as RiskLevel,
    notes: strOrNull(row.notes),
    status: str(row.status) as StepStatus,
    estimatedMs: numOrNull(row.estimatedMs),
    actualMs: numOrNull(row.actualMs),
    estimatedMicroUsd: row.estimatedUsd == null ? null : decimalToMicroUsd(row.estimatedUsd),
    attempt: num(row.attempt),
    startedAt: dateOrNull(row.startedAt),
    endedAt: dateOrNull(row.endedAt),
    createdAt: date(row.createdAt),
  };
}

export function toClaim(row: Row): ClaimRecord {
  return {
    id: str(row.id),
    stepId: str(row.stepId),
    entity: str(row.entity),
    field: str(row.field),
    value: row.value,
    unit: strOrNull(row.unit),
    sourceUrl: str(row.sourceUrl),
    sourceSelector: strOrNull(row.sourceSelector),
    sourceText: strOrNull(row.sourceText),
    screenshotKey: strOrNull(row.screenshotKey),
    domSnapshotKey: strOrNull(row.domSnapshotKey),
    extractedAt: date(row.extractedAt),
    extractedBy: str(row.extractedBy),
    promptVersion: str(row.promptVersion),
    confidence: decimalToConfidence(row.confidence),
    status: str(row.status) as ClaimStatus,
    ambiguity: strOrNull(row.ambiguity),
    nullReason: strOrNull(row.nullReason),
    supersedesId: strOrNull(row.supersedesId),
    correctedBy: strOrNull(row.correctedBy),
  };
}

export function toVerdict(row: Row): VerdictRecord {
  return {
    id: str(row.id),
    claimId: str(row.claimId),
    verdict: str(row.verdict) as ClaimStatus,
    independentReading: row.independentReading,
    rationale: strOrNull(row.rationale),
    confidence: decimalToConfidence(row.confidence),
    model: str(row.model),
    createdAt: date(row.createdAt),
  };
}

export function toCritique(row: Row): CritiqueRecord {
  return {
    id: str(row.id),
    runId: str(row.runId),
    kind: str(row.kind) as CritiqueKind,
    severity: str(row.severity) as Severity,
    message: str(row.message),
    claimIds: strArray(row.claimIds),
    remedy: json(row.remedy) ?? {},
    resolution: str(row.resolution) as CritiqueResolution,
    resolvedBy: strOrNull(row.resolvedBy),
    resolvedAt: dateOrNull(row.resolvedAt),
    createdAt: date(row.createdAt),
  };
}

export function toApproval(row: Row): ApprovalRecord {
  return {
    id: str(row.id),
    stepId: str(row.stepId),
    userId: strOrNull(row.userId),
    trustLevel: num(row.trustLevel),
    action: json(row.action) ?? {},
    payload: json(row.payload),
    editedPayload: json(row.editedPayload),
    screenshotKey: strOrNull(row.screenshotKey),
    reason: str(row.reason),
    status: str(row.status) as ApprovalStatus,
    scope: str(row.scope) as ApprovalScope,
    requestedAt: date(row.requestedAt),
    decidedAt: dateOrNull(row.decidedAt),
  };
}

export function toRecoveryAttempt(row: Row): RecoveryAttemptRecord {
  return {
    id: str(row.id),
    stepId: str(row.stepId),
    attempt: num(row.attempt),
    errorCode: str(row.errorCode),
    errorClass: str(row.errorClass),
    strategy: str(row.strategy),
    rationale: strOrNull(row.rationale),
    expectedOutcome: strOrNull(row.expectedOutcome),
    succeeded: boolOrNull(row.succeeded),
    costMicroUsd: decimalToMicroUsd(row.costUsd),
    createdAt: date(row.createdAt),
  };
}

export function toUndoFrame(row: Row): UndoFrameRecord {
  return {
    id: str(row.id),
    stepId: str(row.stepId),
    seq: num(row.seq),
    url: str(row.url),
    scrollY: num(row.scrollY),
    domSnapshotKey: str(row.domSnapshotKey),
    screenshotKey: str(row.screenshotKey),
    cookiesKey: strOrNull(row.cookiesKey),
    reversible: bool(row.reversible),
    createdAt: date(row.createdAt),
  };
}

export function toEvent(row: Row): EventRecord {
  return {
    id: str(row.id),
    runId: str(row.runId),
    // `seq` is BIGINT in Postgres and arrives as a bigint. Run event counts are in the
    // hundreds, so Number() is exact here and keeps the value JSON-serialisable — a
    // bigint would throw the moment it hit JSON.stringify on the way to a WebSocket.
    seq: Number(row.seq),
    type: str(row.type),
    agent: strOrNull(row.agent),
    stepId: strOrNull(row.stepId),
    payload: row.payload,
    causationId: strOrNull(row.causationId),
    correlationId: strOrNull(row.correlationId),
    ts: date(row.ts),
  };
}

export function toLlmCall(row: Row): LlmCallRecord {
  return {
    id: str(row.id),
    runId: str(row.runId),
    stepId: strOrNull(row.stepId),
    agent: str(row.agent),
    model: str(row.model),
    promptVersion: str(row.promptVersion),
    inputTokens: num(row.inputTokens),
    outputTokens: num(row.outputTokens),
    cachedTokens: num(row.cachedTokens),
    costMicroUsd: decimalToMicroUsd(row.costUsd),
    latencyMs: num(row.latencyMs),
    cached: bool(row.cached),
    fallbackUsed: bool(row.fallbackUsed),
    schemaViolation: bool(row.schemaViolation),
    createdAt: date(row.createdAt),
  };
}

export function toArtifact(row: Row): ArtifactRecord {
  return {
    id: str(row.id),
    runId: str(row.runId),
    kind: str(row.kind) as ArtifactKind,
    r2Key: str(row.r2Key),
    mime: str(row.mime),
    bytes: num(row.bytes),
    createdAt: date(row.createdAt),
  };
}

export function toRecipe(row: Row): RecipeRecord {
  return {
    id: str(row.id),
    orgId: str(row.orgId),
    name: str(row.name),
    goalTemplate: str(row.goalTemplate),
    planTemplate: json(row.planTemplate) ?? {},
    corrections: json(row.corrections),
    runCount: num(row.runCount),
    successRate: row.successRate == null ? null : decimalToConfidence(row.successRate),
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
  };
}

export function toShareLink(row: Row): ShareLinkRecord {
  return {
    id: str(row.id),
    runId: str(row.runId),
    createdBy: str(row.createdBy),
    expiresAt: date(row.expiresAt),
    revokedAt: dateOrNull(row.revokedAt),
    viewCount: num(row.viewCount),
    createdAt: date(row.createdAt),
  };
}
