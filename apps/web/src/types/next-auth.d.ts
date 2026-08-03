import type { ApprovalAuthority, Role } from '@quorum/core';
import type { DefaultSession } from 'next-auth';

/**
 * Module augmentation for the session and token shapes.
 *
 * Without this, `session.user.role` is `any` and every authority check in the UI is
 * unverified by the compiler — which defeats the purpose of having a type-safe policy
 * layer in the first place.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: Role;
      approvalAuthority: ApprovalAuthority;
      maxApprovalTrustLevel: number | null;
      orgMaxApprovalTrustLevel: number;
    } & DefaultSession['user'];
    /** Bearer credential for the Fastify API. Rotated by the jwt callback. */
    accessToken?: string;
    /** Identifies this device's token family, so it can be revoked individually. */
    familyId?: string;
    /** Set when rotation failed; the UI reads it to explain why sign-in is needed. */
    error?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    accessToken?: string;
    accessTokenExpiresAt?: number;
    refreshToken?: string;
    familyId?: string;
    error?: string;
  }
}

export {};
