import { TrustLevel } from '@quorum/core';
import type { AuthError } from './errors.js';
import { describe, expect, it } from 'vitest';
import {
  assertPermission,
  capabilitiesFromClaims,
  claimsCanApprove,
  describePermission,
  hasPermission,
} from './capabilities.js';
import type { AccessTokenClaims } from './types.js';

const claims = (over: Partial<AccessTokenClaims> = {}): AccessTokenClaims => ({
  sub: 'usr_1',
  org: 'org_1',
  email: 'maya@chen-cpa.com',
  role: 'MEMBER',
  apa: 'INHERIT',
  mtl: null,
  otl: TrustLevel.L4_EXTERNAL,
  tv: 0,
  jti: 'jti_1',
  iat: 0,
  exp: 0,
  iss: 'quorum',
  aud: 'quorum:api',
  ...over,
});

describe('capabilitiesFromClaims', () => {
  it('derives permissions and approval ceiling without a database read', () => {
    const caps = capabilitiesFromClaims(claims());
    expect(caps.permissions).toContain('run:create');
    expect(caps.approvalCeiling).toBe(TrustLevel.L3_COMMIT);
    expect(caps.canApproveAnything).toBe(true);
  });

  it('reports a viewer as unable to approve while still able to read', () => {
    const caps = capabilitiesFromClaims(claims({ role: 'VIEWER' }));
    expect(caps.permissions).toContain('run:read');
    expect(caps.approvalCeiling).toBeNull();
    expect(caps.canApproveAnything).toBe(false);
  });

  it('honours a revocation carried in the token', () => {
    expect(
      capabilitiesFromClaims(claims({ role: 'OWNER', apa: 'REVOKED' })).canApproveAnything,
    ).toBe(false);
  });

  it('clamps to the org ceiling embedded in the token', () => {
    const caps = capabilitiesFromClaims(claims({ role: 'OWNER', otl: TrustLevel.L2_MUTATE }));
    expect(caps.approvalCeiling).toBe(TrustLevel.L2_MUTATE);
  });
});

describe('permission assertions', () => {
  it('permits what the role allows', () => {
    expect(hasPermission(claims(), 'run:create')).toBe(true);
    expect(() => {
      assertPermission(claims(), 'run:create');
    }).not.toThrow();
  });

  it('throws a 403 whose human message names the missing capability in plain English', () => {
    expect.assertions(4);
    try {
      assertPermission(claims({ role: 'VIEWER' }), 'run:create');
    } catch (error) {
      const authError = error as AuthError;
      expect(authError.statusCode).toBe(403);
      expect(authError.code).toBe('E_FORBIDDEN');
      // The developer-facing message stays terse; the sentence the person reads is
      // carried separately so it can be rendered without leaking internals.
      expect(authError.message).toBe('permission denied');
      expect(authError.humanMessage).toMatch(/cannot start runs/);
    }
  });

  it('describes every permission, so no UI can render an empty reason', () => {
    for (const p of capabilitiesFromClaims(claims({ role: 'OWNER' })).permissions) {
      expect(describePermission(p).length).toBeGreaterThan(3);
    }
  });
});

describe('claimsCanApprove', () => {
  it('lets a member approve a commit but not credentials', () => {
    expect(claimsCanApprove(claims(), TrustLevel.L3_COMMIT)).toBe(true);
    expect(claimsCanApprove(claims(), TrustLevel.L4_EXTERNAL)).toBe(false);
  });

  it('lets an explicitly granted member approve L4', () => {
    expect(
      claimsCanApprove(
        claims({ apa: 'GRANTED', mtl: TrustLevel.L4_EXTERNAL }),
        TrustLevel.L4_EXTERNAL,
      ),
    ).toBe(true);
  });
});
