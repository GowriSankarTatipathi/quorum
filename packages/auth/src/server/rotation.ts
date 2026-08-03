import { newId } from '@quorum/core';
import type { CreateRefreshTokenInput, RefreshTokenRecord, UserWithOrg } from '@quorum/db';
import { AuthError, accountDisabled, refreshReused } from '../errors.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../tokens.js';
import type { IssuedTokenPair, SessionUser, TokenRequestContext } from '../types.js';

/**
 * The persistence the rotation service needs, declared as an interface.
 *
 * Depending on a narrow port rather than the concrete repositories keeps the security
 * logic testable without a database — and refresh-token rotation is precisely the code
 * that must be exhaustively tested, because its failure modes are silent.
 */
export interface RefreshTokenStore {
  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  rotate(currentId: string, replacement: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;
  revokeFamily(familyId: string): Promise<number>;
  revokeAllForUser(userId: string): Promise<number>;
}

export interface UserStore {
  findByIdWithOrg(id: string): Promise<UserWithOrg | null>;
  bumpTokenVersion(id: string): Promise<number>;
}

export interface AuditSink {
  recordSafely(input: {
    type:
      | 'SIGN_IN'
      | 'SIGN_OUT'
      | 'SIGN_OUT_ALL'
      | 'TOKEN_REFRESHED'
      | 'TOKEN_REUSE_DETECTED'
      | 'SESSION_REVOKED';
    userId?: string | null;
    orgId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    detail?: Record<string, unknown> | null;
  }): Promise<void>;
}

export interface SessionServiceOptions {
  refreshTokens: RefreshTokenStore;
  users: UserStore;
  audit: AuditSink;
  secret: string;
  accessTokenTtlS: number;
  refreshTokenTtlS: number;
  now?: () => number;
}

const toSessionUser = (user: UserWithOrg): SessionUser => ({
  id: user.id,
  orgId: user.orgId,
  email: user.email,
  name: user.name,
  image: user.image,
  role: user.role,
  approvalAuthority: user.approvalAuthority,
  maxApprovalTrustLevel: user.maxApprovalTrustLevel,
  tokenVersion: user.tokenVersion,
});

export class SessionService {
  constructor(private readonly opts: SessionServiceOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private async mintPair(
    user: UserWithOrg,
    familyId: string,
    ctx: TokenRequestContext,
    rotateFrom?: RefreshTokenRecord,
  ): Promise<IssuedTokenPair> {
    const now = this.now();
    const access = await signAccessToken({
      user: toSessionUser(user),
      orgMaxApprovalTrustLevel: user.org.maxApprovalTrustLevel,
      secret: this.opts.secret,
      ttlSeconds: this.opts.accessTokenTtlS,
      now,
    });

    const refreshToken = generateRefreshToken();
    const tokenHash = await hashRefreshToken(refreshToken);
    const refreshExpiresAt = new Date(now + this.opts.refreshTokenTtlS * 1000);

    const input: CreateRefreshTokenInput = {
      familyId,
      userId: user.id,
      tokenHash,
      expiresAt: refreshExpiresAt,
      userAgent: ctx.userAgent ?? null,
      ipAddress: ctx.ipAddress ?? null,
    };

    if (rotateFrom) await this.opts.refreshTokens.rotate(rotateFrom.id, input);
    else await this.opts.refreshTokens.create(input);

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: Math.floor(refreshExpiresAt.getTime() / 1000),
      familyId,
    };
  }

  /** Called once at sign-in. Starts a new token family. */
  async startSession(userId: string, ctx: TokenRequestContext = {}): Promise<IssuedTokenPair> {
    const user = await this.opts.users.findByIdWithOrg(userId);
    if (!user) throw new AuthError('E_REFRESH_UNKNOWN', 'user not found', 'Sign in again.');
    if (user.disabledAt) throw accountDisabled();

    const pair = await this.mintPair(user, newId(), ctx);
    await this.opts.audit.recordSafely({
      type: 'SIGN_IN',
      userId: user.id,
      orgId: user.orgId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      detail: { familyId: pair.familyId },
    });
    return pair;
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * The important branch is the third one. A token that has already been rotated is,
   * by construction, a token someone kept a copy of — the legitimate client discarded
   * it when it received the replacement. At that moment the legitimate holder and the
   * attacker are indistinguishable, so the correct action is to revoke the entire
   * family and make both sign in again. Refusing only the replayed token would leave
   * whichever party holds the newest one in possession of the account.
   */
  async refresh(presentedToken: string, ctx: TokenRequestContext = {}): Promise<IssuedTokenPair> {
    const tokenHash = await hashRefreshToken(presentedToken);
    const record = await this.opts.refreshTokens.findByHash(tokenHash);

    if (!record)
      throw new AuthError(
        'E_REFRESH_UNKNOWN',
        'refresh token not recognised',
        'Your session has ended. Sign in again.',
      );

    if (record.revokedAt)
      throw new AuthError(
        'E_REFRESH_REVOKED',
        'refresh token was revoked',
        'This session was signed out. Sign in again to continue.',
      );

    if (record.rotatedAt) {
      await this.opts.refreshTokens.revokeFamily(record.familyId);
      await this.opts.users.bumpTokenVersion(record.userId);
      await this.opts.audit.recordSafely({
        type: 'TOKEN_REUSE_DETECTED',
        userId: record.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        detail: {
          familyId: record.familyId,
          replayedTokenId: record.id,
          rotatedAt: record.rotatedAt.toISOString(),
        },
      });
      throw refreshReused();
    }

    if (record.expiresAt.getTime() <= this.now())
      throw new AuthError(
        'E_REFRESH_EXPIRED',
        'refresh token expired',
        'Your session expired. Sign in again.',
      );

    const user = await this.opts.users.findByIdWithOrg(record.userId);
    if (!user)
      throw new AuthError('E_REFRESH_UNKNOWN', 'user not found', 'Your session has ended.');
    if (user.disabledAt) {
      await this.opts.refreshTokens.revokeAllForUser(user.id);
      throw accountDisabled();
    }

    const pair = await this.mintPair(user, record.familyId, ctx, record);
    await this.opts.audit.recordSafely({
      type: 'TOKEN_REFRESHED',
      userId: user.id,
      orgId: user.orgId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      detail: { familyId: record.familyId },
    });
    return pair;
  }

  /** Ends one session (one device). Other devices keep working. */
  async endSession(familyId: string, userId: string): Promise<void> {
    await this.opts.refreshTokens.revokeFamily(familyId);
    await this.opts.audit.recordSafely({
      type: 'SESSION_REVOKED',
      userId,
      detail: { familyId },
    });
  }

  /**
   * Ends every session. Bumping the token version is what makes this immediate: without
   * it, outstanding access tokens would keep working until their 15 minutes elapsed,
   * which is not what anyone means by "sign out everywhere".
   */
  async endAllSessions(userId: string): Promise<void> {
    await this.opts.refreshTokens.revokeAllForUser(userId);
    await this.opts.users.bumpTokenVersion(userId);
    await this.opts.audit.recordSafely({ type: 'SIGN_OUT_ALL', userId });
  }
}
