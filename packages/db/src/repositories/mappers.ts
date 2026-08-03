import type { ApprovalAuthority, Role } from '@quorum/core';
import type {
  AuthEventRecord,
  AuthEventType,
  OrgRecord,
  RefreshTokenRecord,
  UserRecord,
  UserWithOrg,
} from '../types.js';

/**
 * Prisma rows are `any` until `prisma generate` has run, so mapping is centralised in
 * one file. Everything outside this module receives fully typed domain records, and
 * the type-unsafe surface is auditable at a glance.
 */
type Row = Record<string, unknown>;

/** Prisma returns Decimal and Date objects; `String()` on those would silently yield
 *  "[object Object]", so the primitive conversion is made explicit. */
const asString = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v) ?? '';
};
const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(asString(v)));
const asDateOrNull = (v: unknown): Date | null => (v == null ? null : asDate(v));
const asStringOrNull = (v: unknown): string | null => (v == null ? null : asString(v));
const asNumber = (v: unknown): number => Number(v);
const asNumberOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export function toOrg(row: Row): OrgRecord {
  return {
    id: asString(row.id),
    name: asString(row.name),
    slug: asString(row.slug),
    allowedDomains: Array.isArray(row.allowedDomains) ? row.allowedDomains.map(asString) : [],
    // Prisma returns Decimal; Number() is safe here because this is a two-decimal
    // configuration value, never an accumulated total.
    maxRunBudgetUsd: asNumber(row.maxRunBudgetUsd),
    requireApprovalAbove: asNumber(row.requireApprovalAbove),
    maxApprovalTrustLevel: asNumber(row.maxApprovalTrustLevel),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  };
}

export function toUser(row: Row): UserRecord {
  return {
    id: asString(row.id),
    orgId: asString(row.orgId),
    email: asString(row.email),
    emailVerified: asDateOrNull(row.emailVerified),
    name: asStringOrNull(row.name),
    image: asStringOrNull(row.image),
    role: asString(row.role) as Role,
    approvalAuthority: asString(row.approvalAuthority) as ApprovalAuthority,
    maxApprovalTrustLevel: asNumberOrNull(row.maxApprovalTrustLevel),
    tokenVersion: asNumber(row.tokenVersion),
    disabledAt: asDateOrNull(row.disabledAt),
    lastLoginAt: asDateOrNull(row.lastLoginAt),
    createdAt: asDate(row.createdAt),
    updatedAt: asDate(row.updatedAt),
  };
}

export function toUserWithOrg(row: Row): UserWithOrg {
  return { ...toUser(row), org: toOrg(row.org as Row) };
}

export function toRefreshToken(row: Row): RefreshTokenRecord {
  return {
    id: asString(row.id),
    familyId: asString(row.familyId),
    userId: asString(row.userId),
    expiresAt: asDate(row.expiresAt),
    rotatedAt: asDateOrNull(row.rotatedAt),
    revokedAt: asDateOrNull(row.revokedAt),
    replacedById: asStringOrNull(row.replacedById),
    userAgent: asStringOrNull(row.userAgent),
    ipAddress: asStringOrNull(row.ipAddress),
    createdAt: asDate(row.createdAt),
  };
}

export function toAuthEvent(row: Row): AuthEventRecord {
  return {
    id: asString(row.id),
    type: asString(row.type) as AuthEventType,
    userId: asStringOrNull(row.userId),
    orgId: asStringOrNull(row.orgId),
    actorUserId: asStringOrNull(row.actorUserId),
    provider: asStringOrNull(row.provider),
    ipAddress: asStringOrNull(row.ipAddress),
    userAgent: asStringOrNull(row.userAgent),
    detail: (row.detail as Record<string, unknown> | null) ?? null,
    createdAt: asDate(row.createdAt),
  };
}
