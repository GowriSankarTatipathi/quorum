/** Lifecycle of a run. Mirrors the XState machine and the Prisma `RunStatus` enum. */
export const RUN_STATUSES = [
  'CREATED',
  'PLANNING',
  'AWAITING_APPROVAL',
  'EXECUTING',
  'VERIFYING',
  'CRITIQUE',
  'RECOVERING',
  'PAUSED',
  'TAKEOVER',
  'FORMATTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
export const isTerminal = (s: RunStatus): boolean => TERMINAL_RUN_STATUSES.includes(s);

export const AUTONOMY_MODES = ['CAREFUL', 'BALANCED', 'AUTONOMOUS'] as const;
export type AutonomyMode = (typeof AUTONOMY_MODES)[number];

export const STEP_STATUSES = [
  'PENDING',
  'RUNNING',
  'BLOCKED',
  'DONE',
  'FAILED',
  'SKIPPED',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const CLAIM_STATUSES = [
  'UNVERIFIED',
  'VERIFIED',
  'CONTRADICTED',
  'UNSUPPORTED',
  'AMBIGUOUS',
  'SUPERSEDED',
  'HUMAN_CORRECTED',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * What the product should DO about a claim. Deliberately distinct from ClaimStatus,
 * which records what we LEARNED about it — so escalation policy can change without
 * migrating history.
 */
export const DISPOSITIONS = ['ACCEPT', 'FLAG', 'HUMAN_REVIEW', 'QUARANTINE'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const CRITIQUE_KINDS = [
  'UNIT_MISMATCH',
  'OUTLIER',
  'DUPLICATE',
  'COVERAGE_GAP',
  'STALENESS',
  'CONTRADICTION',
  'SUSPICIOUS_UNIFORMITY',
] as const;
export type CritiqueKind = (typeof CRITIQUE_KINDS)[number];

export const SEVERITIES = ['BLOCKING', 'WARNING', 'NOTE'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'TIMEOUT'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const APPROVAL_SCOPES = ['SINGLE', 'SIMILAR_IN_RUN'] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

/** The seven agents plus the human, who is a first-class participant on the bus. */
export const AGENT_IDS = [
  'planner',
  'browser',
  'reasoning',
  'verification',
  'critic',
  'recovery',
  'formatter',
  'human',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_LABELS: Record<AgentId, string> = {
  planner: 'Planner',
  browser: 'Browser',
  reasoning: 'Reasoning',
  verification: 'Verification',
  critic: 'Critic',
  recovery: 'Recovery',
  formatter: 'Formatter',
  human: 'You',
};

/**
 * Workspace roles, ordered by privilege. The realistic workflow is a junior running a
 * run while a partner watches, so read access and authority are modelled separately:
 * see `ApprovalAuthority` and `packages/core/src/policy/permissions.ts`.
 */
export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = {
  OWNER: 3,
  ADMIN: 2,
  MEMBER: 1,
  VIEWER: 0,
};

/**
 * Per-user override of the approval authority implied by a role.
 *
 * `INHERIT` is the default. `GRANTED` lets an org raise a specific person's ceiling
 * (a senior MEMBER who may sign off on credentials); `REVOKED` removes approval
 * authority entirely without demoting someone's read access — which is the actual
 * request firms make when onboarding a contractor.
 */
export const APPROVAL_AUTHORITIES = ['INHERIT', 'GRANTED', 'REVOKED'] as const;
export type ApprovalAuthority = (typeof APPROVAL_AUTHORITIES)[number];
