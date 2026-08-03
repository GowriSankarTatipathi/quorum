import {
  canApprove,
  permissionsFor,
  resolveApprovalCeiling,
  type Permission,
  type TrustLevel,
} from '@quorum/core';
import { forbidden } from './errors.js';
import type { AccessTokenClaims, Capabilities, SessionUser } from './types.js';

/** Derive everything the UI and the API need from a verified token, with no DB read. */
export function capabilitiesFromClaims(claims: AccessTokenClaims): Capabilities {
  const subject = {
    role: claims.role,
    approvalAuthority: claims.apa,
    maxApprovalTrustLevel: claims.mtl,
  };
  const policy = { maxApprovalTrustLevel: claims.otl };
  const approvalCeiling = resolveApprovalCeiling(subject, policy);
  return {
    permissions: permissionsFor(claims.role),
    approvalCeiling,
    canApproveAnything: approvalCeiling !== null,
  };
}

export function capabilitiesFromUser(
  user: SessionUser,
  orgMaxApprovalTrustLevel: number,
): Capabilities {
  const subject = {
    role: user.role,
    approvalAuthority: user.approvalAuthority,
    maxApprovalTrustLevel: user.maxApprovalTrustLevel,
  };
  const policy = { maxApprovalTrustLevel: orgMaxApprovalTrustLevel };
  const approvalCeiling = resolveApprovalCeiling(subject, policy);
  return {
    permissions: permissionsFor(user.role),
    approvalCeiling,
    canApproveAnything: approvalCeiling !== null,
  };
}

export function hasPermission(claims: AccessTokenClaims, permission: Permission): boolean {
  return permissionsFor(claims.role).includes(permission);
}

/** Throws a 403 carrying a sentence written for the person, never a bare "denied". */
export function assertPermission(claims: AccessTokenClaims, permission: Permission): void {
  if (hasPermission(claims, permission)) return;
  throw forbidden(
    `Your role (${claims.role.toLowerCase()}) cannot ${describePermission(permission)}. Ask an administrator.`,
  );
}

export function claimsCanApprove(claims: AccessTokenClaims, level: TrustLevel): boolean {
  return canApprove(
    {
      role: claims.role,
      approvalAuthority: claims.apa,
      maxApprovalTrustLevel: claims.mtl,
    },
    level,
    { maxApprovalTrustLevel: claims.otl },
  );
}

const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'run:read': 'view runs',
  'run:create': 'start runs',
  'run:control': 'pause, resume or stop runs',
  'run:takeover': 'take manual control of a browser session',
  'run:delete': 'delete runs',
  'plan:edit': 'edit a plan',
  'claim:correct': 'correct extracted values',
  'export:create': 'export results',
  'share:create': 'create share links',
  'recipe:read': 'view recipes',
  'recipe:write': 'create or edit recipes',
  'org:read': 'view workspace settings',
  'org:members': 'manage members',
  'org:policy': 'change workspace policy',
  'org:billing': 'manage billing',
};

export function describePermission(permission: Permission): string {
  return PERMISSION_DESCRIPTIONS[permission];
}
