import 'server-only';
import { SessionService } from '@quorum/auth/server';
import { authEventRepository, refreshTokenRepository, userRepository } from '@quorum/db';
import { getServerEnv } from '@/env';

let instance: SessionService | null = null;

/**
 * The one wired instance of the rotation service, constructed on first use.
 *
 * The service depends on narrow ports rather than the repositories, which is what lets
 * its security logic be exercised exhaustively without a database. This module is the
 * single place those ports are bound to real persistence — and it is lazy so that
 * importing it during `next build` does not demand a signing secret.
 */
export function getSessionService(): SessionService {
  if (!instance) {
    const env = getServerEnv();
    instance = new SessionService({
      refreshTokens: refreshTokenRepository,
      users: userRepository,
      audit: authEventRepository,
      secret: env.JWT_SECRET,
      accessTokenTtlS: env.ACCESS_TOKEN_TTL_S,
      refreshTokenTtlS: env.REFRESH_TOKEN_TTL_S,
    });
  }
  return instance;
}
