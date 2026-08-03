import { prisma } from '../client.js';
import type { ArtifactKind, ArtifactRecord } from '../types.js';
import { toArtifact } from './runtime-mappers.js';

export interface CreateArtifactInput {
  runId: string;
  kind: ArtifactKind;
  r2Key: string;
  mime: string;
  bytes: number;
}

export const artifactRepository = {
  async record(input: CreateArtifactInput): Promise<ArtifactRecord> {
    return toArtifact(await prisma.artifact.create({ data: input }));
  },

  async recordMany(inputs: readonly CreateArtifactInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await prisma.artifact.createMany({ data: [...inputs] });
    return Number((result as { count: unknown }).count);
  },

  async listForRun(runId: string, kind?: ArtifactKind): Promise<ArtifactRecord[]> {
    const rows: unknown[] = await prisma.artifact.findMany({
      where: { runId, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toArtifact(r as Record<string, unknown>));
  },

  async findLatestExport(runId: string, kind: ArtifactKind): Promise<ArtifactRecord | null> {
    const row = await prisma.artifact.findFirst({
      where: { runId, kind },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toArtifact(row) : null;
  },

  /**
   * Storage is the dominant object-store cost: ~360 screenshots per three-minute run.
   * The retention job needs the keys to delete from R2, so it collects them before the
   * rows go — deleting the rows first would orphan the objects permanently.
   */
  async listKeysOlderThan(
    cutoff: Date,
    kinds: readonly ArtifactKind[],
    limit = 1000,
  ): Promise<{ id: string; r2Key: string }[]> {
    const rows: unknown[] = await prisma.artifact.findMany({
      where: { createdAt: { lt: cutoff }, kind: { in: [...kinds] } },
      select: { id: true, r2Key: true },
      take: limit,
    });
    return rows.map((r) => r as { id: string; r2Key: string });
  },

  async deleteByIds(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await prisma.artifact.deleteMany({ where: { id: { in: [...ids] } } });
    return Number((result as { count: unknown }).count);
  },

  async totalBytesForRun(runId: string): Promise<number> {
    const result = await prisma.artifact.aggregate({
      where: { runId },
      _sum: { bytes: true },
    });
    return Number((result as { _sum: { bytes: number | null } })._sum.bytes ?? 0);
  },
};

export type ArtifactRepository = typeof artifactRepository;
