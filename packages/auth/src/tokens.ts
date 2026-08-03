import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { newId } from '@quorum/core';
import { AuthError, tokenExpired } from './errors.js';
import { TOKEN_AUDIENCE, TOKEN_ISSUER, type AccessTokenClaims, type SessionUser } from './types.js';

/**
 * `jose` rather than `jsonwebtoken`: it runs unchanged in Node, in the edge runtime
 * used by Next.js middleware, and in a Web Crypto context. One library signing and
 * verifying everywhere removes the class of bug where two JWT implementations
 * disagree about algorithm handling.
 */
const ALGORITHM = 'HS256';

const encodeSecret = (secret: string): Uint8Array => new TextEncoder().encode(secret);

export interface SignAccessTokenInput {
  user: SessionUser;
  /** Org-wide approval ceiling, embedded so the API need not load the org per request. */
  orgMaxApprovalTrustLevel: number;
  secret: string;
  ttlSeconds: number;
  now?: number;
}

export interface SignedAccessToken {
  token: string;
  jti: string;
  expiresAt: number;
  issuedAt: number;
}

export async function signAccessToken(input: SignAccessTokenInput): Promise<SignedAccessToken> {
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const expiresAt = issuedAt + input.ttlSeconds;
  const jti = newId();

  const token = await new SignJWT({
    org: input.user.orgId,
    email: input.user.email,
    role: input.user.role,
    apa: input.user.approvalAuthority,
    mtl: input.user.maxApprovalTrustLevel,
    otl: input.orgMaxApprovalTrustLevel,
    tv: input.user.tokenVersion,
  })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(input.user.id)
    .setJti(jti)
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(encodeSecret(input.secret));

  return { token, jti, expiresAt, issuedAt };
}

/**
 * Verify signature, issuer, audience and expiry. Every failure mode maps to a distinct
 * code so the caller can tell "expired, refresh it" apart from "forged, log it" —
 * collapsing both into a 401 loses the signal that matters for security monitoring.
 */
export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret), {
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      algorithms: [ALGORITHM],
      clockTolerance: 5,
    });
    return payload as unknown as AccessTokenClaims;
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) throw tokenExpired();
    if (error instanceof joseErrors.JWTClaimValidationFailed)
      throw new AuthError(
        'E_TOKEN_AUDIENCE',
        `token claim rejected: ${error.claim}`,
        'This session is not valid for this application. Sign in again.',
      );
    if (error instanceof joseErrors.JWSSignatureVerificationFailed)
      throw new AuthError(
        'E_TOKEN_SIGNATURE',
        'token signature verification failed',
        'Your session could not be verified. Sign in again.',
      );
    throw new AuthError(
      'E_TOKEN_MALFORMED',
      `token could not be parsed: ${String(error)}`,
      'Your session could not be read. Sign in again.',
    );
  }
}

/** True when the token is close enough to expiry that it should be rotated now. */
export function shouldRefresh(expiresAt: number, skewSeconds: number, now = Date.now()): boolean {
  return Math.floor(now / 1000) >= expiresAt - skewSeconds;
}

/**
 * Refresh tokens are 256 bits of CSPRNG output, not JWTs.
 *
 * They carry no claims and are never parsed — the database row is the source of truth
 * for who they belong to and whether they are still live. That means a refresh token
 * cannot be forged by anyone who learns the signing secret, and revocation is a row
 * update rather than a denylist entry.
 */
export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Only the SHA-256 hash is stored, so a database disclosure yields nothing usable.
 * A plain hash is correct here (unlike for passwords): the input is 256 bits of
 * uniform randomness, so there is nothing for a slow KDF to protect against.
 */
export async function hashRefreshToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time comparison, for any path that compares secrets outside the database. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
