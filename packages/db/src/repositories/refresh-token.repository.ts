import { prisma } from '../client.js';
import type { CreateRefreshTokenInput, RefreshTokenRecord } from '../types.js';
import { toRefreshToken } from './mappers.js';

export const refreshTokenRepository = {
  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    return toRefreshToken(await prisma.refreshToken.create({ data: input }));
  },

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    return row ? toRefreshToken(row) : null;
  },

  /**
   * Rotation is a single transaction: the replacement is written and the predecessor
   * is marked rotated together. A crash between the two would either leak a token that
   * still works or lock the user out, and both are worse than a failed refresh.
   */
  async rotate(
    currentId: string,
    replacement: CreateRefreshTokenInput,
  ): Promise<RefreshTokenRecord> {
    const [created] = await prisma.$transaction([
      prisma.refreshToken.create({ data: replacement }),
      prisma.refreshToken.update({
        where: { id: currentId },
        data: { rotatedAt: new Date() },
      }),
    ]);
    const next = toRefreshToken(created);
    await prisma.refreshToken.update({
      where: { id: currentId },
      data: { replacedById: next.id },
    });
    return next;
  },

  /**
   * Revoke an entire family at once. Called when an already-rotated token is presented,
   * which means the token was captured and replayed: the legitimate holder and the
   * attacker are indistinguishable at that point, so both are signed out.
   */
  async revokeFamily(familyId: string): Promise<number> {
    const result = await prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return Number((result as { count: unknown }).count);
  },

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return Number((result as { count: unknown }).count);
  },

  /** One row per family, newest first — the shape the session-management UI needs. */
  async listActiveFamilies(userId: string): Promise<RefreshTokenRecord[]> {
    const rows: unknown[] = await prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const seen = new Set<string>();
    const families: RefreshTokenRecord[] = [];
    for (const raw of rows) {
      const token = toRefreshToken(raw as Record<string, unknown>);
      if (seen.has(token.familyId)) continue;
      seen.add(token.familyId);
      families.push(token);
    }
    return families;
  },

  /** Expired rows are pruned on a schedule; rotated-but-unexpired rows are kept,
   *  because reuse detection depends on remembering them. */
  async deleteExpired(before: Date = new Date()): Promise<number> {
    const result = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: before } } });
    return Number((result as { count: unknown }).count);
  },
};

export type RefreshTokenRepository = typeof refreshTokenRepository;
