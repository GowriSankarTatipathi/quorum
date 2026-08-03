import type { ApprovalAuthority, Permission, Role, TrustLevel } from '@quorum/core';

/** Audience and issuer are pinned so a token minted for one surface cannot be replayed
 *  against another. */
export const TOKEN_ISSUER = 'quorum';
export const TOKEN_AUDIENCE = 'quorum:api';

/**
 * Claims carried by an access token.
 *
 * `role`, `apa` and `mtl` are embedded so the API can authorise a request without a
 * database round trip; `tv` (token version) is what keeps that safe — any change to
 * authority increments it and instantly invalidates tokens carrying the old value.
 */
export interface AccessTokenClaims {
  /** Subject: user id. */
  sub: string;
  /** Organisation id. */
  org: string;
  email: string;
  role: Role;
  /** Approval authority. */
  apa: ApprovalAuthority;
  /** Explicit max approval trust level, when granted. */
  mtl: number | null;
  /** Org-wide approval ceiling, so the API can clamp without loading the org. */
  otl: number;
  /** Token version. */
  tv: number;
  /** JWT id — the key used by the revocation denylist. */
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface SessionUser {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  approvalAuthority: ApprovalAuthority;
  maxApprovalTrustLevel: number | null;
  tokenVersion: number;
}

/** What the UI needs to render authority correctly without duplicating the policy. */
export interface Capabilities {
  permissions: readonly Permission[];
  /** Highest Trust Ladder level this person may approve; null means none at all. */
  approvalCeiling: TrustLevel | null;
  canApproveAnything: boolean;
}

export interface IssuedTokenPair {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  refreshTokenExpiresAt: number;
  familyId: string;
}

export interface TokenRequestContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}
