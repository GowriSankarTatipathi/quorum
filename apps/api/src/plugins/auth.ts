import {
  AuthError,
  accountDisabled,
  assertPermission,
  capabilitiesFromClaims,
  claimsCanApprove,
  staleTokenVersion,
  tokenRevoked,
  verifyAccessToken,
  type AccessTokenClaims,
  type Capabilities,
} from '@quorum/auth';
import { AccessTokenDenylist } from '@quorum/auth/server';
import type { Permission, TrustLevel } from '@quorum/core';
import { authEventRepository, userRepository } from '@quorum/db';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../env.js';
import { redis } from '../redis.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Verified token claims. Present only after `authenticate` has run. */
    auth?: AccessTokenClaims;
    capabilities?: Capabilities;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireApprovalAuthority: (
      level: TrustLevel,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// ioredis structurally satisfies the narrow DenylistStore port, so no adapter or cast
// is required — which is the payoff for declaring the port rather than importing ioredis
// into @quorum/auth.
const denylist = new AccessTokenDenylist(redis);

function bearerFrom(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Request authentication.
 *
 * The design is "stateless first, with two escape hatches". Claims carry role and
 * approval authority so the common case costs zero database reads, and the two things
 * that must take effect immediately — an explicit sign-out and a change of authority —
 * are handled by a Redis denylist lookup and a token-version comparison. Without those,
 * "sign out" and "demote" would both mean "in up to fifteen minutes", which is not what
 * either word means.
 */
async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = bearerFrom(request);
  if (!token)
    throw new AuthError('E_TOKEN_MISSING', 'no bearer token', 'You need to sign in to do that.');

  const claims = await verifyAccessToken(token, env.JWT_SECRET);

  // The denylist fails CLOSED. A revoked session must not be honoured because a cache
  // is unreachable, so an unavailable store is a 503 rather than a silent pass. This is
  // the opposite of the rate limiter's policy, and deliberately so: one protects the
  // service, this protects the account.
  let revoked: boolean;
  try {
    revoked = await denylist.isRevoked(claims.jti);
  } catch (error) {
    request.log.error({ err: error }, 'session revocation store unavailable');
    throw new AuthError(
      'E_TOKEN_REVOKED',
      'revocation store unavailable; failing closed',
      'We could not verify your session right now. Please try again in a moment.',
      503,
    );
  }
  if (revoked) throw tokenRevoked();

  // One indexed read, only to compare the version counter. Authority itself still comes
  // from the token, so a slow database degrades latency rather than correctness.
  const user = await userRepository.findById(claims.sub);
  if (!user) throw new AuthError('E_TOKEN_MALFORMED', 'user no longer exists', 'Sign in again.');
  if (user.disabledAt) throw accountDisabled();
  if (user.tokenVersion !== claims.tv) throw staleTokenVersion();

  request.auth = claims;
  request.capabilities = capabilitiesFromClaims(claims);
}

export function requireAuth(request: FastifyRequest): AccessTokenClaims {
  if (!request.auth)
    throw new AuthError('E_TOKEN_MISSING', 'route is not authenticated', 'You need to sign in.');
  return request.auth;
}

export default fp(function authPlugin(app: FastifyInstance, _opts: unknown, done: () => void) {
  app.decorateRequest('auth', undefined);
  app.decorateRequest('capabilities', undefined);

  app.decorate('authenticate', authenticate);

  app.decorate('requirePermission', (permission: Permission) => {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await authenticate(request, reply);
      const claims = requireAuth(request);
      try {
        assertPermission(claims, permission);
      } catch (error) {
        await authEventRepository.recordSafely({
          type: 'ACCESS_DENIED',
          userId: claims.sub,
          orgId: claims.org,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          detail: { permission, route: request.url, method: request.method },
        });
        throw error;
      }
    };
  });

  /**
   * Approval authority is enforced by its own guard, not by a permission check.
   *
   * A route that mutates a run and a route that signs off on an irreversible action are
   * different kinds of authority, and collapsing them into one matrix is how a viewer
   * ends up able to approve a form submission.
   */
  app.decorate('requireApprovalAuthority', (level: TrustLevel) => {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      await authenticate(request, reply);
      const claims = requireAuth(request);
      if (claimsCanApprove(claims, level)) return;

      await authEventRepository.recordSafely({
        type: 'ACCESS_DENIED',
        userId: claims.sub,
        orgId: claims.org,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
        detail: { trustLevel: level, route: request.url, method: request.method },
      });

      const ceiling = request.capabilities?.approvalCeiling ?? null;
      throw new AuthError(
        'E_FORBIDDEN',
        'approval authority insufficient',
        ceiling === null
          ? 'Your role can watch runs but cannot approve actions. Ask a member or administrator to approve this step.'
          : `This step is level L${String(level)}; you can approve up to L${String(ceiling)}. Ask an administrator to approve it.`,
        403,
      );
    };
  });

  done();
});

export { denylist };
