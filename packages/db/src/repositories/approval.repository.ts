import { type Prisma } from '../../generated/client/index.js';
import { prisma } from '../client.js';
import type { ApprovalRecord, ApprovalScope, CreateApprovalInput } from '../types.js';
import { toApproval } from './runtime-mappers.js';

export const approvalRepository = {
  async request(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const row = await prisma.approval.create({
      data: {
        stepId: input.stepId,
        trustLevel: input.trustLevel,
        action: input.action as Prisma.InputJsonValue, // Prisma requires InputJsonValue for json fields
        payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined, // Prisma requires InputJsonValue for json fields
        screenshotKey: input.screenshotKey ?? null,
        reason: input.reason,
      },
    });
    return toApproval(row);
  },

  async findById(id: string): Promise<ApprovalRecord | null> {
    const row = await prisma.approval.findUnique({ where: { id } });
    return row ? toApproval(row) : null;
  },

  /**
   * Every decision is attributable: who decided, when, and the exact payload approved —
   * including any edits. In a regulated profession "who authorised this" is the first
   * question after anything goes wrong, and it cannot be reconstructed later.
   */
  async decide(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    userId: string,
    editedPayload: Record<string, unknown> | null,
    scope: ApprovalScope,
  ): Promise<ApprovalRecord> {
    return toApproval(
      await prisma.approval.update({
        where: { id },
        data: {
          status: decision,
          userId,
          editedPayload: (editedPayload ?? undefined) as Prisma.InputJsonValue | undefined, // Prisma requires InputJsonValue for json fields
          scope,
          decidedAt: new Date(),
        },
      }),
    );
  },

  /** A timeout is not a rejection: the person went for coffee. The run parks instead. */
  async timeout(id: string): Promise<ApprovalRecord> {
    return toApproval(
      await prisma.approval.update({
        where: { id },
        data: { status: 'TIMEOUT', decidedAt: new Date() },
      }),
    );
  },

  async listPendingForRun(runId: string): Promise<ApprovalRecord[]> {
    const rows: unknown[] = await prisma.approval.findMany({
      where: { step: { runId }, status: 'PENDING' },
      orderBy: { requestedAt: 'asc' },
    });
    return rows.map((r) => toApproval(r as Record<string, unknown>));
  },

  async listForRun(runId: string): Promise<ApprovalRecord[]> {
    const rows: unknown[] = await prisma.approval.findMany({
      where: { step: { runId } },
      orderBy: { requestedAt: 'asc' },
    });
    return rows.map((r) => toApproval(r as Record<string, unknown>));
  },

  /**
   * "Auto-approve similar actions" is scoped to a single run and to the same trust
   * level. Blanket permissions are how approval systems die; a session-scoped consent
   * keeps the gate meaningful the next time it matters.
   */
  async hasRunScopedConsent(runId: string, trustLevel: number): Promise<boolean> {
    const existing = await prisma.approval.findFirst({
      where: {
        step: { runId },
        trustLevel,
        status: 'APPROVED',
        scope: 'SIMILAR_IN_RUN',
      },
      select: { id: true },
    });
    return existing !== null;
  },

  async countByStatusForRun(runId: string): Promise<Record<string, number>> {
    const rows = await prisma.approval.groupBy({
      by: ['status'],
      where: { step: { runId } },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const r of rows) {
      counts[r.status] = Number(r._count._all);
    }
    return counts;
  },
};

export type ApprovalRepository = typeof approvalRepository;
