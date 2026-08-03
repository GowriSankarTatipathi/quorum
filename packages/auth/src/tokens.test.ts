import { describe, expect, it } from 'vitest';
import { AuthError } from './errors.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  shouldRefresh,
  signAccessToken,
  timingSafeEqual,
  verifyAccessToken,
} from './tokens.js';
import type { SessionUser } from './types.js';

const SECRET = 'a-test-secret-that-is-at-least-32-characters';
const OTHER_SECRET = 'a-different-secret-of-at-least-32-characters';

const user: SessionUser = {
  id: 'usr_1',
  orgId: 'org_1',
  email: 'maya@chen-cpa.com',
  name: 'Maya Chen',
  image: null,
  role: 'MEMBER',
  approvalAuthority: 'INHERIT',
  maxApprovalTrustLevel: null,
  tokenVersion: 3,
};

const sign = (over: Partial<Parameters<typeof signAccessToken>[0]> = {}) =>
  signAccessToken({
    user,
    orgMaxApprovalTrustLevel: 4,
    secret: SECRET,
    ttlSeconds: 900,
    ...over,
  });

describe('access tokens', () => {
  it('round-trips every authority claim needed to authorise without a database read', async () => {
    const { token } = await sign();
    const claims = await verifyAccessToken(token, SECRET);
    expect(claims.sub).toBe('usr_1');
    expect(claims.org).toBe('org_1');
    expect(claims.role).toBe('MEMBER');
    expect(claims.apa).toBe('INHERIT');
    expect(claims.otl).toBe(4);
    expect(claims.tv).toBe(3);
    expect(claims.jti).toBeTruthy();
  });

  it('mints a unique jti per token so revocation targets one session', async () => {
    const [a, b] = await Promise.all([sign(), sign()]);
    expect(a.jti).not.toBe(b.jti);
  });

  it('rejects a token signed with a different secret', async () => {
    const { token } = await sign();
    await expect(verifyAccessToken(token, OTHER_SECRET)).rejects.toMatchObject({
      code: 'E_TOKEN_SIGNATURE',
    });
  });

  it('rejects a tampered payload', async () => {
    const { token } = await sign();
    const [header, , signature] = token.split('.');
    const forged = `${header!}.${btoa(JSON.stringify({ sub: 'usr_2', role: 'OWNER' }))}.${signature!}`;
    await expect(verifyAccessToken(forged, SECRET)).rejects.toBeInstanceOf(AuthError);
  });

  it('distinguishes expiry from forgery, because the responses differ', async () => {
    const { token } = await sign({ ttlSeconds: 1, now: Date.now() - 10_000 });
    await expect(verifyAccessToken(token, SECRET)).rejects.toMatchObject({
      code: 'E_TOKEN_EXPIRED',
    });
  });

  it('rejects a malformed token without throwing a raw parse error', async () => {
    await expect(verifyAccessToken('not.a.token', SECRET)).rejects.toBeInstanceOf(AuthError);
  });
});

describe('shouldRefresh', () => {
  const now = 1_700_000_000_000;
  const nowSeconds = Math.floor(now / 1000);

  it('is false well before expiry', () => {
    expect(shouldRefresh(nowSeconds + 600, 60, now)).toBe(false);
  });

  it('is true inside the skew window, so a request never races the boundary', () => {
    expect(shouldRefresh(nowSeconds + 30, 60, now)).toBe(true);
  });

  it('is true after expiry', () => {
    expect(shouldRefresh(nowSeconds - 1, 60, now)).toBe(true);
  });
});

describe('refresh tokens', () => {
  it('generates url-safe high-entropy opaque strings', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateRefreshToken()));
    expect(seen.size).toBe(500);
  });

  it('hashes deterministically and irreversibly for storage', async () => {
    const token = generateRefreshToken();
    const a = await hashRefreshToken(token);
    const b = await hashRefreshToken(token);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain(token);
  });

  it('produces different hashes for different tokens', async () => {
    expect(await hashRefreshToken('a')).not.toBe(await hashRefreshToken('b'));
  });
});

describe('timingSafeEqual', () => {
  it('compares correctly', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});
