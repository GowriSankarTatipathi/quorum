import type {
  ApprovalAuthority,
  AutonomyMode,
  ClaimStatus,
  CritiqueKind,
  RiskLevel,
  Role,
  RunStatus,
  Severity,
  StepStatus,
} from '@quorum/core';

/**
 * Domain row types.
 *
 * Repositories return these rather than Prisma's generated types. Three reasons:
 * consumers do not take a build-order dependency on `prisma generate`; `Decimal` and
 * `Date` are normalised at one boundary instead of at every call site; and the
 * database's shape can change without every caller changing with it.
 */

export interface OrgRecord {
  id: string;
  name: string;
  slug: string;
  allowedDomains: string[];
  /** Two-decimal configuration value, not an accumulated cost. */
  maxRunBudgetUsd: number;
  requireApprovalAbove: number;
  maxApprovalTrustLevel: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRecord {
  id: string;
  orgId: string;
  email: string;
  emailVerified: Date | null;
  name: string | null;
  image: string | null;
  role: Role;
  approvalAuthority: ApprovalAuthority;
  maxApprovalTrustLevel: number | null;
  tokenVersion: number;
  disabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A user together with the workspace policy that constrains them. */
export interface UserWithOrg extends UserRecord {
  org: OrgRecord;
}

export interface RefreshTokenRecord {
  id: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  replacedById: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

export type AuthEventType =
  | 'SIGN_IN'
  | 'SIGN_OUT'
  | 'SIGN_OUT_ALL'
  | 'TOKEN_REFRESHED'
  | 'TOKEN_REUSE_DETECTED'
  | 'SESSION_REVOKED'
  | 'ROLE_CHANGED'
  | 'APPROVAL_AUTHORITY_CHANGED'
  | 'ACCESS_DENIED'
  | 'ACCOUNT_DISABLED';

export interface AuthEventRecord {
  id: string;
  type: AuthEventType;
  userId: string | null;
  orgId: string | null;
  actorUserId: string | null;
  provider: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  detail: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateAuthEventInput {
  type: AuthEventType;
  userId?: string | null;
  orgId?: string | null;
  actorUserId?: string | null;
  provider?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface CreateRefreshTokenInput {
  familyId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface UpdateUserAuthorityInput {
  role?: Role;
  approvalAuthority?: ApprovalAuthority;
  maxApprovalTrustLevel?: number | null;
}

export interface OrgPolicyInput {
  allowedDomains?: string[];
  maxRunBudgetUsd?: number;
  requireApprovalAbove?: number;
  maxApprovalTrustLevel?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run-time domain
// ─────────────────────────────────────────────────────────────────────────────

export type CritiqueResolution = 'OPEN' | 'ACCEPTED' | 'DISMISSED' | 'REMEDIED';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'TIMEOUT';
export type ApprovalScope = 'SINGLE' | 'SIMILAR_IN_RUN';
export type ArtifactKind =
  | 'SCREENSHOT'
  | 'DOM_SNAPSHOT'
  | 'EXPORT_XLSX'
  | 'EXPORT_CSV'
  | 'EXPORT_JSON'
  | 'EXPORT_PDF'
  | 'RECORDING';

export interface RunRecord {
  id: string;
  userId: string;
  orgId: string;
  recipeId: string | null;
  goal: string;
  mode: AutonomyMode;
  status: RunStatus;
  planHash: string | null;
  /** Money is carried as integer micro-dollars so totals equal the sum of line items. */
  budgetMicroUsd: number;
  spentMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  browserSessionId: string | null;
  liveViewUrl: string | null;
  errorCode: string | null;
  errorDetail: Record<string, unknown> | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Only loaded when resuming a run; the blobs are large and rarely needed. */
export interface RunSnapshot {
  machineState: Record<string, unknown> | null;
  blackboard: Record<string, unknown> | null;
}

export interface CreateRunInput {
  userId: string;
  orgId: string;
  goal: string;
  mode: AutonomyMode;
  budgetMicroUsd: number;
  recipeId?: string | null;
}

export interface StepRecord {
  id: string;
  runId: string;
  index: number;
  objective: string;
  targetUrl: string | null;
  agentPath: string[];
  outputSchema: Record<string, unknown> | null;
  riskLevel: RiskLevel;
  notes: string | null;
  status: StepStatus;
  estimatedMs: number | null;
  actualMs: number | null;
  estimatedMicroUsd: number | null;
  attempt: number;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

export interface CreateStepInput {
  index: number;
  objective: string;
  targetUrl?: string | null;
  agentPath?: string[];
  outputSchema?: Record<string, unknown> | null;
  riskLevel?: RiskLevel;
  notes?: string | null;
  estimatedMs?: number | null;
  estimatedMicroUsd?: number | null;
}

export interface ClaimRecord {
  id: string;
  stepId: string;
  entity: string;
  field: string;
  value: unknown;
  unit: string | null;
  sourceUrl: string;
  sourceSelector: string | null;
  sourceText: string | null;
  screenshotKey: string | null;
  domSnapshotKey: string | null;
  extractedAt: Date;
  extractedBy: string;
  promptVersion: string;
  confidence: number | null;
  status: ClaimStatus;
  ambiguity: string | null;
  nullReason: string | null;
  supersedesId: string | null;
  correctedBy: string | null;
}

export interface CreateClaimInput {
  stepId: string;
  entity: string;
  field: string;
  value: unknown;
  unit?: string | null;
  sourceUrl: string;
  sourceSelector?: string | null;
  sourceText?: string | null;
  screenshotKey?: string | null;
  domSnapshotKey?: string | null;
  extractedBy: string;
  promptVersion: string;
  confidence: number | null;
  ambiguity?: string | null;
  nullReason?: string | null;
}

export interface VerdictRecord {
  id: string;
  claimId: string;
  verdict: ClaimStatus;
  independentReading: unknown;
  rationale: string | null;
  confidence: number | null;
  model: string;
  createdAt: Date;
}

export interface CreateVerdictInput {
  claimId: string;
  verdict: ClaimStatus;
  independentReading?: unknown;
  rationale?: string | null;
  confidence: number | null;
  model: string;
}

export interface CritiqueRecord {
  id: string;
  runId: string;
  kind: CritiqueKind;
  severity: Severity;
  message: string;
  claimIds: string[];
  remedy: Record<string, unknown>;
  resolution: CritiqueResolution;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface CreateCritiqueInput {
  runId: string;
  kind: CritiqueKind;
  severity: Severity;
  message: string;
  claimIds: string[];
  remedy: Record<string, unknown>;
}

export interface ApprovalRecord {
  id: string;
  stepId: string;
  userId: string | null;
  trustLevel: number;
  action: Record<string, unknown>;
  payload: Record<string, unknown> | null;
  editedPayload: Record<string, unknown> | null;
  screenshotKey: string | null;
  reason: string;
  status: ApprovalStatus;
  scope: ApprovalScope;
  requestedAt: Date;
  decidedAt: Date | null;
}

export interface CreateApprovalInput {
  stepId: string;
  trustLevel: number;
  action: Record<string, unknown>;
  payload?: Record<string, unknown> | null;
  screenshotKey?: string | null;
  reason: string;
}

export interface RecoveryAttemptRecord {
  id: string;
  stepId: string;
  attempt: number;
  errorCode: string;
  errorClass: string;
  strategy: string;
  rationale: string | null;
  expectedOutcome: string | null;
  succeeded: boolean | null;
  costMicroUsd: number;
  createdAt: Date;
}

export interface UndoFrameRecord {
  id: string;
  stepId: string;
  seq: number;
  url: string;
  scrollY: number;
  domSnapshotKey: string;
  screenshotKey: string;
  cookiesKey: string | null;
  reversible: boolean;
  createdAt: Date;
}

export interface EventRecord {
  id: string;
  runId: string;
  seq: number;
  type: string;
  agent: string | null;
  stepId: string | null;
  payload: unknown;
  causationId: string | null;
  correlationId: string | null;
  ts: Date;
}

export interface CreateEventInput {
  id: string;
  runId: string;
  seq: number;
  type: string;
  agent?: string | null;
  stepId?: string | null;
  payload: unknown;
  causationId?: string | null;
  correlationId?: string | null;
}

export interface LlmCallRecord {
  id: string;
  runId: string;
  stepId: string | null;
  agent: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costMicroUsd: number;
  latencyMs: number;
  cached: boolean;
  fallbackUsed: boolean;
  schemaViolation: boolean;
  createdAt: Date;
}

export interface CreateLlmCallInput {
  runId: string;
  stepId?: string | null;
  agent: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  costMicroUsd: number;
  latencyMs: number;
  cached?: boolean;
  fallbackUsed?: boolean;
  schemaViolation?: boolean;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  kind: ArtifactKind;
  r2Key: string;
  mime: string;
  bytes: number;
  createdAt: Date;
}

export interface RecipeRecord {
  id: string;
  orgId: string;
  name: string;
  goalTemplate: string;
  planTemplate: Record<string, unknown>;
  corrections: Record<string, unknown> | null;
  runCount: number;
  successRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShareLinkRecord {
  id: string;
  runId: string;
  createdBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  createdAt: Date;
}

/** Aggregated spend for the usage page and the budget governor. */
export interface RunCostBreakdown {
  totalMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  callCount: number;
  byAgent: { agent: string; microUsd: number; callCount: number }[];
}
