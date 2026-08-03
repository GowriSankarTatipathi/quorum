import { signAccessToken, type SessionUser } from '@quorum/auth';
import { TrustLevel } from '@quorum/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

/**
 * These exercise the guards end-to-end through a real Fastify instance with real route
 * schemas — the layer where an authorisation mistake actually reaches a user. Handlers
 * that need the database are not asserted here; the point is the gate in front of them.
 */
const SECRET = 'test-secret-that-is-at-least-32-characters-long';

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'usr_1',
  orgId: 'org_1',
  email: 'maya@chen-cpa.com',
  name: 'Maya Chen',
  image: null,
  role: 'MEMBER',
  approvalAuthority: 'INHERIT',
  maxApprovalTrustLevel: null,
  tokenVersion: 0,
  ...over,
});

const bearer = async (over: Partial<SessionUser> = {}, ttlSeconds = 900): Promise<string> => {
  const { token } = await signAccessToken({
    user: user(over),
    orgMaxApprovalTrustLevel: TrustLevel.L4_EXTERNAL,
    secret: SECRET,
    ttlSeconds,
  });
  return `Bearer ${token}`;
};

describe('protected routes', () => {
  it('rejects a request with no credentials, in the standard error envelope', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: { code: string; message: string; requestId: string } }>();
    expect(body.error.code).toBe('E_TOKEN_MISSING');
    expect(body.error.message).toMatch(/sign in/i);
    expect(body.error.requestId).toBeTruthy();
    await app.close();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const app = await buildApp();
    const { token } = await signAccessToken({
      user: user(),
      orgMaxApprovalTrustLevel: 4,
      secret: 'a-completely-different-secret-32-characters',
      ttlSeconds: 900,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('E_TOKEN_SIGNATURE');
    await app.close();
  });

  it('distinguishes an expired token from a forged one', async () => {
    const app = await buildApp();
    const { token } = await signAccessToken({
      user: user(),
      orgMaxApprovalTrustLevel: 4,
      secret: SECRET,
      ttlSeconds: 1,
      now: Date.now() - 60_000,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json<{ error: { code: string } }>().error.code).toBe('E_TOKEN_EXPIRED');
    await app.close();
  });

  it('ignores a non-bearer authorization header rather than trying to parse it', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.json<{ error: { code: string } }>().error.code).toBe('E_TOKEN_MISSING');
    await app.close();
  });

  it('leaves health probes unauthenticated so orchestrators are never locked out', async () => {
    const app = await buildApp();
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    await app.close();
  });

  it('documents protected routes with a bearer security requirement', async () => {
    const app = await buildApp();
    await app.ready();
    const spec = app.swagger() as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };
    expect(spec.paths['/v1/me']?.get?.security).toBeDefined();
    expect(spec.paths['/v1/org/policy']?.patch?.security).toBeDefined();
    await app.close();
  });

  it('exposes the guards the rest of the application composes with', async () => {
    const app = await buildApp();
    expect(typeof app.authenticate).toBe('function');
    expect(typeof app.requirePermission).toBe('function');
    expect(typeof app.requireApprovalAuthority).toBe('function');
    await app.close();
  });

  it('accepts a well-formed bearer token as far as the handler', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me/capabilities',
      headers: { authorization: await bearer() },
    });
    // Without a database the token-version check cannot complete, so this must not be
    // a 401: reaching a non-authentication failure proves the token itself was accepted.
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });
});
