import { describe, expect, it } from 'vitest';
import type { ApprovalAuthority, Role } from '../enums.js';
import {
  DEFAULT_ORG_APPROVAL_POLICY,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  can,
  canApprove,
  canManageRole,
  explainApprovalDenial,
  permissionsFor,
  resolveApprovalCeiling,
  type ApprovalSubject,
} from './permissions.js';
import { TrustLevel } from './trust-ladder.js';

const subject = (
  role: Role,
  approvalAuthority: ApprovalAuthority = 'INHERIT',
  maxApprovalTrustLevel: TrustLevel | null = null,
): ApprovalSubject => ({ role, approvalAuthority, maxApprovalTrustLevel });

describe('role permission matrix', () => {
  it('gives a viewer read access and nothing that changes state', () => {
    expect(can('VIEWER', 'run:read')).toBe(true);
    expect(can('VIEWER', 'run:create')).toBe(false);
    expect(can('VIEWER', 'run:control')).toBe(false);
    expect(can('VIEWER', 'plan:edit')).toBe(false);
  });

  it('is monotonic: every role holds everything the role below it holds', () => {
    const order: Role[] = ['VIEWER', 'MEMBER', 'ADMIN', 'OWNER'];
    for (let i = 1; i < order.length; i += 1) {
      const lower = ROLE_PERMISSIONS[order[i - 1]!];
      const higher = ROLE_PERMISSIONS[order[i]!];
      for (const p of lower) expect(higher).toContain(p);
    }
  });

  it('reserves billing for the owner', () => {
    expect(can('ADMIN', 'org:billing')).toBe(false);
    expect(can('OWNER', 'org:billing')).toBe(true);
  });

  it('grants the owner every declared permission', () => {
    expect([...permissionsFor('OWNER')].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('does not model approval as an ordinary permission', () => {
    expect(PERMISSIONS as readonly string[]).not.toContain('run:approve');
  });
});

describe('approval authority is separate from read and write access', () => {
  it('a viewer can read runs but cannot approve anything', () => {
    expect(can('VIEWER', 'run:read')).toBe(true);
    expect(resolveApprovalCeiling(subject('VIEWER'))).toBeNull();
    expect(canApprove(subject('VIEWER'), TrustLevel.L0_READ)).toBe(false);
  });

  it('a member may approve commits but not credentials or payment', () => {
    expect(canApprove(subject('MEMBER'), TrustLevel.L3_COMMIT)).toBe(true);
    expect(canApprove(subject('MEMBER'), TrustLevel.L4_EXTERNAL)).toBe(false);
  });

  it('an admin may approve up to L4', () => {
    expect(canApprove(subject('ADMIN'), TrustLevel.L4_EXTERNAL)).toBe(true);
  });

  it('REVOKED removes approval authority without touching write access', () => {
    const contractor = subject('ADMIN', 'REVOKED');
    expect(can(contractor.role, 'run:create')).toBe(true);
    expect(canApprove(contractor, TrustLevel.L2_MUTATE)).toBe(false);
    expect(resolveApprovalCeiling(contractor)).toBeNull();
  });

  it('GRANTED raises a specific person above their role default', () => {
    const seniorMember = subject('MEMBER', 'GRANTED', TrustLevel.L4_EXTERNAL);
    expect(canApprove(seniorMember, TrustLevel.L4_EXTERNAL)).toBe(true);
  });

  it('org policy clamps an explicit grant — it can only tighten, never loosen', () => {
    const seniorMember = subject('MEMBER', 'GRANTED', TrustLevel.L4_EXTERNAL);
    const strict = { maxApprovalTrustLevel: TrustLevel.L2_MUTATE };
    expect(canApprove(seniorMember, TrustLevel.L4_EXTERNAL, strict)).toBe(false);
    expect(canApprove(seniorMember, TrustLevel.L2_MUTATE, strict)).toBe(true);
  });

  it('org policy also clamps role defaults, so tightening needs no per-member audit', () => {
    const strict = { maxApprovalTrustLevel: TrustLevel.L2_MUTATE };
    expect(resolveApprovalCeiling(subject('OWNER'), strict)).toBe(TrustLevel.L2_MUTATE);
  });

  it('a revocation cannot be overridden by a role or by policy', () => {
    expect(
      resolveApprovalCeiling(subject('OWNER', 'REVOKED'), DEFAULT_ORG_APPROVAL_POLICY),
    ).toBeNull();
  });

  it('GRANTED without an explicit level falls back to the role default', () => {
    expect(resolveApprovalCeiling(subject('MEMBER', 'GRANTED', null))).toBe(TrustLevel.L3_COMMIT);
  });
});

describe('explainApprovalDenial', () => {
  it('returns null when the action is permitted', () => {
    expect(explainApprovalDenial(subject('ADMIN'), TrustLevel.L3_COMMIT)).toBeNull();
  });

  it('names the reason rather than saying "denied"', () => {
    expect(explainApprovalDenial(subject('VIEWER'), TrustLevel.L3_COMMIT)).toMatch(/watch runs/);
    expect(explainApprovalDenial(subject('MEMBER', 'REVOKED'), TrustLevel.L1_NAV)).toMatch(
      /revoked/,
    );
    expect(explainApprovalDenial(subject('MEMBER'), TrustLevel.L4_EXTERNAL)).toMatch(
      /L4.*up to L3/,
    );
  });
});

describe('canManageRole', () => {
  it('lets an admin manage a member but not another admin', () => {
    expect(canManageRole('ADMIN', 'MEMBER', 'VIEWER')).toBe(true);
    expect(canManageRole('ADMIN', 'ADMIN', 'MEMBER')).toBe(false);
  });

  it('forbids promoting anyone above yourself', () => {
    expect(canManageRole('ADMIN', 'MEMBER', 'OWNER')).toBe(false);
    expect(canManageRole('OWNER', 'ADMIN', 'OWNER')).toBe(true);
  });

  it('requires the org:members permission in the first place', () => {
    expect(canManageRole('MEMBER', 'VIEWER', 'VIEWER')).toBe(false);
  });
});
