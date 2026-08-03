import type { ApprovalAuthority, Role } from '../enums.js';
import { ROLE_RANK } from '../enums.js';
import { TrustLevel } from './trust-ladder.js';

/**
 * Capabilities are named after what a person may DO, not after the routes that happen
 * to implement them. Routes get renamed; authority does not.
 */
export const PERMISSIONS = [
  'run:read',
  'run:create',
  'run:control',
  'run:takeover',
  'run:delete',
  'plan:edit',
  'claim:correct',
  'export:create',
  'share:create',
  'recipe:read',
  'recipe:write',
  'org:read',
  'org:members',
  'org:policy',
  'org:billing',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Note what is absent: there is no `run:approve` here.
 *
 * Approval authority is deliberately NOT a row in this matrix. Treating it as one more
 * permission would make it something an admin toggles alongside "can edit recipes",
 * and it would silently inherit whatever a role grants. It is the one capability whose
 * misuse is legally material to an accounting firm, so it is modelled separately, is
 * scoped by Trust Ladder level, and is resolved by `resolveApprovalCeiling` below.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  VIEWER: ['run:read', 'recipe:read', 'org:read'],
  MEMBER: [
    'run:read',
    'run:create',
    'run:control',
    'run:takeover',
    'plan:edit',
    'claim:correct',
    'export:create',
    'share:create',
    'recipe:read',
    'recipe:write',
    'org:read',
  ],
  ADMIN: [
    'run:read',
    'run:create',
    'run:control',
    'run:takeover',
    'run:delete',
    'plan:edit',
    'claim:correct',
    'export:create',
    'share:create',
    'recipe:read',
    'recipe:write',
    'org:read',
    'org:members',
    'org:policy',
  ],
  OWNER: [...PERMISSIONS],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Ceiling implied by a role alone, before any per-user override or org policy. */
export const ROLE_APPROVAL_CEILING: Record<Role, TrustLevel | null> = {
  // A viewer watches. Granting approval authority by default to anyone who can see a
  // run is how approval gates quietly stop meaning anything.
  VIEWER: null,
  MEMBER: TrustLevel.L3_COMMIT,
  // Only administrators may authorise credentials, payment, or navigation outside the
  // plan's declared domains.
  ADMIN: TrustLevel.L4_EXTERNAL,
  OWNER: TrustLevel.L4_EXTERNAL,
};

export interface ApprovalSubject {
  role: Role;
  approvalAuthority: ApprovalAuthority;
  /** Explicit per-user ceiling. Only meaningful when authority is `GRANTED`. */
  maxApprovalTrustLevel: TrustLevel | null;
}

export interface OrgApprovalPolicy {
  /** Org-wide hard ceiling. Never raises an individual's authority, only lowers it. */
  maxApprovalTrustLevel: TrustLevel;
}

export const DEFAULT_ORG_APPROVAL_POLICY: OrgApprovalPolicy = {
  maxApprovalTrustLevel: TrustLevel.L4_EXTERNAL,
};

/**
 * Resolve the highest Trust Ladder level a person may approve.
 *
 * Precedence, and why:
 *   1. `REVOKED` wins outright — a revocation that could be overridden by a role is
 *      not a revocation.
 *   2. `GRANTED` raises the ceiling to an explicit level, but only within org policy.
 *   3. Otherwise the role's default applies.
 *   4. Org policy clamps the result in every branch, so a workspace can tighten
 *      globally without auditing every member.
 *
 * Returns `null` when the subject may not approve anything at all.
 */
export function resolveApprovalCeiling(
  subject: ApprovalSubject,
  policy: OrgApprovalPolicy = DEFAULT_ORG_APPROVAL_POLICY,
): TrustLevel | null {
  if (subject.approvalAuthority === 'REVOKED') return null;

  const base =
    subject.approvalAuthority === 'GRANTED'
      ? (subject.maxApprovalTrustLevel ?? ROLE_APPROVAL_CEILING[subject.role])
      : ROLE_APPROVAL_CEILING[subject.role];

  if (base === null) return null;
  return Math.min(base, policy.maxApprovalTrustLevel);
}

/** Whether this person may approve an action at the given Trust Ladder level. */
export function canApprove(
  subject: ApprovalSubject,
  level: TrustLevel,
  policy: OrgApprovalPolicy = DEFAULT_ORG_APPROVAL_POLICY,
): boolean {
  const ceiling = resolveApprovalCeiling(subject, policy);
  return ceiling !== null && level <= ceiling;
}

/** Sentence shown in the UI when an approval control is disabled. Never a bare "denied". */
export function explainApprovalDenial(
  subject: ApprovalSubject,
  level: TrustLevel,
  policy: OrgApprovalPolicy = DEFAULT_ORG_APPROVAL_POLICY,
): string | null {
  if (canApprove(subject, level, policy)) return null;
  if (subject.approvalAuthority === 'REVOKED')
    return 'Your approval authority has been revoked for this workspace. Ask an administrator to approve this step.';
  const ceiling = resolveApprovalCeiling(subject, policy);
  if (ceiling === null)
    return 'Your role can watch runs but cannot approve actions. Ask a member or administrator to approve this step.';
  return `This step is level L${String(level)}; you can approve up to L${String(ceiling)}. Ask an administrator to approve it.`;
}

/** True when `actor` may change `target`'s role. Nobody may promote above themselves. */
export function canManageRole(actor: Role, target: Role, next: Role): boolean {
  if (!can(actor, 'org:members')) return false;
  return ROLE_RANK[actor] > ROLE_RANK[target] && ROLE_RANK[actor] >= ROLE_RANK[next];
}
