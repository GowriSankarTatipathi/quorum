import type { ClaimStatus } from '@quorum/core';
import { prisma } from '../client.js';
import type { ClaimRecord, CreateClaimInput, CreateVerdictInput, VerdictRecord } from '../types.js';
import { toClaim, toVerdict } from './runtime-mappers.js';

/** Confidence is DECIMAL(4,3); clamping here keeps a model that returns 1.4 from
 *  overflowing the column and taking down the extraction that produced it. */
const confidenceString = (value: number): string => Math.min(1, Math.max(0, value)).toFixed(3);

export const claimRepository = {
  async create(input: CreateClaimInput): Promise<ClaimRecord> {
    const row = await prisma.claim.create({
      data: {
        stepId: input.stepId,
        entity: input.entity,
        field: input.field,
        value: input.value ?? null,
        unit: input.unit ?? null,
        sourceUrl: input.sourceUrl,
        sourceSelector: input.sourceSelector ?? null,
        sourceText: input.sourceText ?? null,
        screenshotKey: input.screenshotKey ?? null,
        domSnapshotKey: input.domSnapshotKey ?? null,
        extractedBy: input.extractedBy,
        promptVersion: input.promptVersion,
        confidence: confidenceString(input.confidence),
        ambiguity: input.ambiguity ?? null,
        nullReason: input.nullReason ?? null,
      },
    });
    return toClaim(row);
  },

  async createMany(inputs: readonly CreateClaimInput[]): Promise<ClaimRecord[]> {
    const rows: unknown[] = await prisma.$transaction(
      inputs.map((input) =>
        prisma.claim.create({
          data: {
            stepId: input.stepId,
            entity: input.entity,
            field: input.field,
            value: input.value ?? null,
            unit: input.unit ?? null,
            sourceUrl: input.sourceUrl,
            sourceSelector: input.sourceSelector ?? null,
            sourceText: input.sourceText ?? null,
            screenshotKey: input.screenshotKey ?? null,
            domSnapshotKey: input.domSnapshotKey ?? null,
            extractedBy: input.extractedBy,
            promptVersion: input.promptVersion,
            confidence: confidenceString(input.confidence),
            ambiguity: input.ambiguity ?? null,
            nullReason: input.nullReason ?? null,
          },
        }),
      ),
    );
    return rows.map((r) => toClaim(r as Record<string, unknown>));
  },

  async findById(id: string): Promise<ClaimRecord | null> {
    const row = await prisma.claim.findUnique({ where: { id } });
    return row ? toClaim(row) : null;
  },

  async listForRun(runId: string): Promise<ClaimRecord[]> {
    const rows: unknown[] = await prisma.claim.findMany({
      where: { step: { runId } },
      orderBy: [{ extractedAt: 'asc' }],
    });
    return rows.map((r) => toClaim(r as Record<string, unknown>));
  },

  /** What the Critic sees: the current view of the run, with corrections applied. */
  async listCurrentForRun(runId: string): Promise<ClaimRecord[]> {
    const rows: unknown[] = await prisma.claim.findMany({
      where: { step: { runId }, status: { not: 'SUPERSEDED' } },
      orderBy: [{ entity: 'asc' }, { field: 'asc' }],
    });
    return rows.map((r) => toClaim(r as Record<string, unknown>));
  },

  /**
   * Time travel. The state of the run at any instant is a filter over an append-only
   * log, which is what makes replay a projection rather than a separate feature that
   * can drift from live behaviour.
   */
  async listForRunAsOf(runId: string, asOf: Date): Promise<ClaimRecord[]> {
    const rows: unknown[] = await prisma.claim.findMany({
      where: { step: { runId }, extractedAt: { lte: asOf } },
      orderBy: [{ extractedAt: 'asc' }],
    });
    return rows.map((r) => toClaim(r as Record<string, unknown>));
  },

  /**
   * Corrections are appended, never applied in place.
   *
   * The replacement is inserted and the original is marked SUPERSEDED in one
   * transaction, so a reader can never observe both as current or neither as present.
   * The original row survives: an audit trail that discards what was wrong cannot
   * answer the only question anyone asks it.
   */
  async supersede(
    originalId: string,
    replacement: CreateClaimInput,
    correctedBy: string | null,
  ): Promise<ClaimRecord> {
    const [created] = await prisma.$transaction([
      prisma.claim.create({
        data: {
          stepId: replacement.stepId,
          entity: replacement.entity,
          field: replacement.field,
          value: replacement.value ?? null,
          unit: replacement.unit ?? null,
          sourceUrl: replacement.sourceUrl,
          sourceSelector: replacement.sourceSelector ?? null,
          sourceText: replacement.sourceText ?? null,
          screenshotKey: replacement.screenshotKey ?? null,
          domSnapshotKey: replacement.domSnapshotKey ?? null,
          extractedBy: replacement.extractedBy,
          promptVersion: replacement.promptVersion,
          confidence: confidenceString(replacement.confidence),
          ambiguity: replacement.ambiguity ?? null,
          nullReason: replacement.nullReason ?? null,
          supersedesId: originalId,
          correctedBy,
          status: correctedBy ? 'HUMAN_CORRECTED' : 'UNVERIFIED',
        },
      }),
      prisma.claim.update({ where: { id: originalId }, data: { status: 'SUPERSEDED' } }),
    ]);
    return toClaim(created as Record<string, unknown>);
  },

  async setStatus(id: string, status: ClaimStatus): Promise<ClaimRecord> {
    return toClaim(await prisma.claim.update({ where: { id }, data: { status } }));
  },

  async recordVerdict(input: CreateVerdictInput): Promise<VerdictRecord> {
    const [verdict] = await prisma.$transaction([
      prisma.verdict.create({
        data: {
          claimId: input.claimId,
          verdict: input.verdict,
          independentReading: input.independentReading ?? undefined,
          rationale: input.rationale ?? null,
          confidence: confidenceString(input.confidence),
          model: input.model,
        },
      }),
      prisma.claim.update({ where: { id: input.claimId }, data: { status: input.verdict } }),
    ]);
    return toVerdict(verdict as Record<string, unknown>);
  },

  async listVerdicts(claimId: string): Promise<VerdictRecord[]> {
    const rows: unknown[] = await prisma.verdict.findMany({
      where: { claimId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toVerdict(r as Record<string, unknown>));
  },

  /** Verified Extraction Rate — the product's north-star metric, per run. */
  async verifiedRate(runId: string): Promise<{ total: number; verified: number; rate: number }> {
    const [total, verified] = await prisma.$transaction([
      prisma.claim.count({ where: { step: { runId }, status: { not: 'SUPERSEDED' } } }),
      prisma.claim.count({
        where: { step: { runId }, status: { in: ['VERIFIED', 'HUMAN_CORRECTED'] } },
      }),
    ]);
    const totalCount = Number(total);
    const verifiedCount = Number(verified);
    return {
      total: totalCount,
      verified: verifiedCount,
      rate: totalCount === 0 ? 0 : verifiedCount / totalCount,
    };
  },
};

export type ClaimRepository = typeof claimRepository;
