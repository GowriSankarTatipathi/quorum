import { prisma } from '../client.js';
import type { ShareLinkRecord } from '../types.js';
import { toShareLink } from './runtime-mappers.js';

/**
 * Share links are capability tokens, so only a hash is stored. The plaintext exists
 * once, in the URL handed to the recipient — a database disclosure must not turn into
 * read access to every shared run.
 */
export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const shareLinkRepository = {
  async create(input: {
    runId: string;
    createdBy: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<ShareLinkRecord> {
    return toShareLink(await prisma.shareLink.create({ data: input }));
  },

  /**
   * Resolution and view counting happen together, and expiry and revocation are checked
   * in the query rather than after it — so a revoked link cannot be read by a caller who
   * forgets to check, which is the failure mode that makes capability tokens leak.
   */
  async resolve(tokenHash: string): Promise<ShareLinkRecord | null> {
    const row = await prisma.shareLink.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!row) return null;
    const updated = await prisma.shareLink.update({
      where: { id: (row as { id: string }).id },
      data: { viewCount: { increment: 1 } },
    });
    return toShareLink(updated);
  },

  async listForRun(runId: string): Promise<ShareLinkRecord[]> {
    const rows: unknown[] = await prisma.shareLink.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => toShareLink(r as Record<string, unknown>));
  },

  async revoke(id: string): Promise<void> {
    await prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
  },

  async deleteExpired(before: Date = new Date()): Promise<number> {
    const result = await prisma.shareLink.deleteMany({ where: { expiresAt: { lt: before } } });
    return Number((result as { count: unknown }).count);
  },
};

export type ShareLinkRepository = typeof shareLinkRepository;
