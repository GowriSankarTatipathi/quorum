import type { CreateRefreshTokenInput, RefreshTokenRecord, UserWithOrg } from '@quorum/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyAccessToken } from '../tokens.js';
import {
  SessionService,
  type AuditSink,
  type RefreshTokenStore,
  type UserStore,
} from './rotation.js';

const SECRET = 'a-test-secret-that-is-at-least-32-characters';

/**
 * In-memory implementations of the two ports. These are real implementations of the
 * declared contracts, not stand-ins for behaviour under test: the behaviour under test
 * is the rotation logic, and giving it a deterministic store is what makes replay
 * detection assertable at all.
 */
class MemoryRefreshTokenStore implements RefreshTokenStore {
  readonly rows = new Map<string, RefreshTokenRecord>();
  private seq = 0;

  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    this.seq += 1;
    const row: RefreshTokenRecord = {
      id: `rt_${String(this.seq)}`,
      familyId: input.familyId,
      userId: input.userId,
      expiresAt: input.expiresAt,
      rotatedAt: null,
      revokedAt: null,
      replacedById: null,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      createdAt: new Date(),
    };
    this.rows.set(input.tokenHash, row);
    return Promise.resolve(row);
  }

  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return Promise.resolve(this.rows.get(tokenHash) ?? null);
  }

  async rotate(
    currentId: string,
    replacement: CreateRefreshTokenInput,
  ): Promise<RefreshTokenRecord> {
    const next = await this.create(replacement);
    for (const row of this.rows.values()) {
      if (row.id === currentId) {
        row.rotatedAt = new Date();
        row.replacedById = next.id;
      }
    }
    return next;
  }

  revokeFamily(familyId: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.familyId === familyId && !row.revokedAt) {
        row.revokedAt = new Date();
        count += 1;
      }
    }
    return Promise.resolve(count);
  }

  revokeAllForUser(userId: string): Promise<number> {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.userId === userId && !row.revokedAt) {
        row.revokedAt = new Date();
        count += 1;
      }
    }
    return Promise.resolve(count);
  }
}

const makeUser = (over: Partial<UserWithOrg> = {}): UserWithOrg => ({
  id: 'usr_1',
  orgId: 'org_1',
  email: 'maya@chen-cpa.com',
  emailVerified: new Date(),
  name: 'Maya Chen',
  image: null,
  role: 'MEMBER',
  approvalAuthority: 'INHERIT',
  maxApprovalTrustLevel: null,
  tokenVersion: 0,
  disabledAt: null,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  org: {
    id: 'org_1',
    name: 'Chen CPA',
    slug: 'chen-cpa',
    allowedDomains: [],
    maxRunBudgetUsd: 2,
    requireApprovalAbove: 3,
    maxApprovalTrustLevel: 4,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  ...over,
});

class MemoryUserStore implements UserStore {
  constructor(public user: UserWithOrg | null = makeUser()) {}
  findByIdWithOrg(id: string): Promise<UserWithOrg | null> {
    return Promise.resolve(this.user && this.user.id === id ? this.user : null);
  }
  bumpTokenVersion(id: string): Promise<number> {
    if (this.user && this.user.id === id) this.user.tokenVersion += 1;
    return Promise.resolve(this.user?.tokenVersion ?? 0);
  }
}

class MemoryAudit implements AuditSink {
  readonly events: { type: string; detail?: Record<string, unknown> | null }[] = [];
  recordSafely(input: { type: string; detail?: Record<string, unknown> | null }): Promise<void> {
    this.events.push({ type: input.type, detail: input.detail ?? null });
    return Promise.resolve();
  }
  types(): string[] {
    return this.events.map((e) => e.type);
  }
}

describe('SessionService', () => {
  let tokens: MemoryRefreshTokenStore;
  let users: MemoryUserStore;
  let audit: MemoryAudit;
  let service: SessionService;

  beforeEach(() => {
    tokens = new MemoryRefreshTokenStore();
    users = new MemoryUserStore();
    audit = new MemoryAudit();
    service = new SessionService({
      refreshTokens: tokens,
      users,
      audit,
      secret: SECRET,
      accessTokenTtlS: 900,
      refreshTokenTtlS: 3600,
    });
  });

  it('issues a verifiable access token and a refresh token at sign-in', async () => {
    const pair = await service.startSession('usr_1', { ipAddress: '10.0.0.1' });
    const claims = await verifyAccessToken(pair.accessToken, SECRET);
    expect(claims.sub).toBe('usr_1');
    expect(claims.otl).toBe(4);
    expect(pair.refreshToken).not.toBe(pair.accessToken);
    expect(audit.types()).toEqual(['SIGN_IN']);
  });

  it('refuses to start a session for a disabled account', async () => {
    users.user = makeUser({ disabledAt: new Date() });
    await expect(service.startSession('usr_1')).rejects.toMatchObject({
      code: 'E_ACCOUNT_DISABLED',
    });
  });

  it('rotates: refresh returns a new pair and keeps the family', async () => {
    const first = await service.startSession('usr_1');
    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.familyId).toBe(first.familyId);
    expect(audit.types()).toEqual(['SIGN_IN', 'TOKEN_REFRESHED']);
  });

  it('supports a long chain of rotations', async () => {
    let pair = await service.startSession('usr_1');
    const seen = new Set([pair.refreshToken]);
    for (let i = 0; i < 10; i += 1) {
      pair = await service.refresh(pair.refreshToken);
      expect(seen.has(pair.refreshToken)).toBe(false);
      seen.add(pair.refreshToken);
    }
    expect(seen.size).toBe(11);
  });

  it('detects replay: reusing a rotated token revokes the WHOLE family', async () => {
    const first = await service.startSession('usr_1');
    const second = await service.refresh(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'E_REFRESH_REUSED',
    });

    // The attacker is locked out, and so is the legitimate holder of the newest token —
    // at replay time the two are indistinguishable, so both must re-authenticate.
    await expect(service.refresh(second.refreshToken)).rejects.toMatchObject({
      code: 'E_REFRESH_REVOKED',
    });
    expect(audit.types()).toContain('TOKEN_REUSE_DETECTED');
  });

  it('replay also bumps the token version, killing outstanding access tokens', async () => {
    const first = await service.startSession('usr_1');
    await service.refresh(first.refreshToken);
    const before = users.user!.tokenVersion;
    await expect(service.refresh(first.refreshToken)).rejects.toThrow();
    expect(users.user!.tokenVersion).toBe(before + 1);
  });

  it('rejects an unknown refresh token without disclosing why', async () => {
    await expect(service.refresh('never-issued')).rejects.toMatchObject({
      code: 'E_REFRESH_UNKNOWN',
    });
  });

  it('rejects an expired refresh token', async () => {
    let clock = Date.now();
    service = new SessionService({
      refreshTokens: tokens,
      users,
      audit,
      secret: SECRET,
      accessTokenTtlS: 900,
      refreshTokenTtlS: 60,
      now: () => clock,
    });
    const pair = await service.startSession('usr_1');
    clock += 61_000;
    await expect(service.refresh(pair.refreshToken)).rejects.toMatchObject({
      code: 'E_REFRESH_EXPIRED',
    });
  });

  it('revokes every token and disables refresh when the account is disabled', async () => {
    const pair = await service.startSession('usr_1');
    users.user = makeUser({ disabledAt: new Date() });
    await expect(service.refresh(pair.refreshToken)).rejects.toMatchObject({
      code: 'E_ACCOUNT_DISABLED',
    });
  });

  it('ends one session without touching the others', async () => {
    const deviceA = await service.startSession('usr_1');
    const deviceB = await service.startSession('usr_1');
    await service.endSession(deviceA.familyId, 'usr_1');

    await expect(service.refresh(deviceA.refreshToken)).rejects.toMatchObject({
      code: 'E_REFRESH_REVOKED',
    });
    await expect(service.refresh(deviceB.refreshToken)).resolves.toBeDefined();
  });

  it('sign out everywhere revokes all families and bumps the token version', async () => {
    const deviceA = await service.startSession('usr_1');
    const deviceB = await service.startSession('usr_1');
    const before = users.user!.tokenVersion;

    await service.endAllSessions('usr_1');

    expect(users.user!.tokenVersion).toBe(before + 1);
    await expect(service.refresh(deviceA.refreshToken)).rejects.toThrow();
    await expect(service.refresh(deviceB.refreshToken)).rejects.toThrow();
    expect(audit.types()).toContain('SIGN_OUT_ALL');
  });
});
