import { prisma } from '../client.js';
import type { CreateCritiqueInput, CritiqueRecord, CritiqueResolution } from '../types.js';
import { toCritique } from './runtime-mappers.js';

export const critiqueRepository = {
  async create(input: CreateCritiqueInput): Promise<CritiqueRecord> {
    const row = await prisma.critique.create({
      data: {
        runId: input.runId,
        kind: input.kind,
        severity: input.severity,
        message: input.message,
        claimIds: input.claimIds,
        remedy: input.remedy,
      },
    });
    return toCritique(row);
  },

  async createMany(inputs: readonly CreateCritiqueInput[]): Promise<CritiqueRecord[]> {
    if (inputs.length === 0) return [];
    const rows: unknown[] = await prisma.$transaction(
      inputs.map((input) =>
        prisma.critique.create({
          data: {
            runId: input.runId,
            kind: input.kind,
            severity: input.severity,
            message: input.message,
            claimIds: input.claimIds,
            remedy: input.remedy,
          },
        }),
      ),
    );
    return rows.map((r) => toCritique(r as Record<string, unknown>));
  },

  async listForRun(runId: string): Promise<CritiqueRecord[]> {
    const rows: unknown[] = await prisma.critique.findMany({
      where: { runId },
      orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => toCritique(r as Record<string, unknown>));
  },

  /** A run must not be presented as finished while a blocking finding is unresolved. */
  async hasUnresolvedBlocking(runId: string): Promise<boolean> {
    const found = await prisma.critique.findFirst({
      where: { runId, severity: 'BLOCKING', resolution: 'OPEN' },
      select: { id: true },
    });
    return found !== null;
  },

  async resolve(
    id: string,
    resolution: CritiqueResolution,
    resolvedBy: string,
  ): Promise<CritiqueRecord> {
    return toCritique(
      await prisma.critique.update({
        where: { id },
        data: { resolution, resolvedBy, resolvedAt: new Date() },
      }),
    );
  },
};

export type CritiqueRepository = typeof critiqueRepository;
