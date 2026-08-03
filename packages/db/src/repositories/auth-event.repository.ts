import { prisma } from '../client.js';
import type { AuthEventRecord, CreateAuthEventInput } from '../types.js';
import { toAuthEvent } from './mappers.js';

export const authEventRepository = {
  /**
   * Append-only. The application database role holds INSERT and SELECT on this table
   * but not UPDATE or DELETE: an audit trail that can be silently edited is not one.
   */
  async record(input: CreateAuthEventInput): Promise<AuthEventRecord> {
    return toAuthEvent(await prisma.authEvent.create({ data: input }));
  },

  /**
   * Audit writes must never break the request that triggered them. A failed sign-in
   * audit is a monitoring problem; a sign-in that 500s because of one is an outage.
   */
  async recordSafely(input: CreateAuthEventInput): Promise<void> {
    try {
      await prisma.authEvent.create({ data: input });
    } catch (error) {
      console.error('[quorum] failed to record auth event', input.type, error);
    }
  },

  async listForUser(userId: string, limit = 50): Promise<AuthEventRecord[]> {
    const rows: unknown[] = await prisma.authEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => toAuthEvent(r as Record<string, unknown>));
  },
};

export type AuthEventRepository = typeof authEventRepository;
