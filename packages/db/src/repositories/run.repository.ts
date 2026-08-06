import type { AutonomyMode, RunStatus } from '@quorum/core';
import { type Prisma } from '@prisma/client';
import { prisma } from '../client.js';
import { decimalToMicroUsd, microUsdToDecimalString } from '../money.js';
import type { CreateRunInput, RunCostBreakdown, RunRecord, RunSnapshot } from '../types.js';
import { toRun, toRunSnapshot } from './runtime-mappers.js';

export const runRepository = {
  async create(input: CreateRunInput): Promise<RunRecord> {
    const row = await prisma.run.create({
      data: {
        userId: input.userId,
        orgId: input.orgId,
        goal: input.goal,
        mode: input.mode,
        recipeId: input.recipeId ?? null,
        budgetUsd: microUsdToDecimalString(input.budgetMicroUsd),
      },
    });
    return toRun(row);
  },

  async findById(id: string): Promise<RunRecord | null> {
    const row = await prisma.run.findUnique({ where: { id } });
    return row ? toRun(row) : null;
  },

  /**
   * Scoped by organisation, not just by id. Every read path takes the tenant explicitly
   * so that forgetting it is a compile error rather than a data leak; Postgres RLS backs
   * this up independently in case an ORM call ever slips through.
   */
  async findByIdForOrg(id: string, orgId: string): Promise<RunRecord | null> {
    const row = await prisma.run.findFirst({ where: { id, orgId } });
    return row ? toRun(row) : null;
  },

  async listForUser(userId: string, limit = 50, cursor?: string): Promise<RunRecord[]> {
    const rows: unknown[] = await prisma.run.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return rows.map((r) => toRun(r as Record<string, unknown>));
  },

  /** The large JSON blobs are fetched separately because resume is the only reader. */
  async loadSnapshot(id: string): Promise<RunSnapshot | null> {
    const row = await prisma.run.findUnique({
      where: { id },
      select: { machineState: true, blackboard: true },
    });
    return row ? toRunSnapshot(row) : null;
  },

  /**
   * Persisted on every state-machine transition. This is what makes a run survive a
   * worker eviction: a replacement resumes from the last transition instead of
   * restarting three minutes of browser work.
   */
  async saveSnapshot(id: string, status: RunStatus, snapshot: RunSnapshot): Promise<void> {
    await prisma.run.update({
      where: { id },
      data: {
        status,
        machineState: (snapshot.machineState ?? undefined) as Prisma.InputJsonValue | undefined, // Prisma requires InputJsonValue for json fields
        blackboard: (snapshot.blackboard ?? undefined) as Prisma.InputJsonValue | undefined, // Prisma requires InputJsonValue for json fields
      },
    });
  },

  async setStatus(id: string, status: RunStatus): Promise<RunRecord> {
    const now = new Date();
    const terminal = status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED';
    return toRun(
      await prisma.run.update({
        where: { id },
        data: {
          status,
          ...(status === 'PLANNING' ? { startedAt: now } : {}),
          ...(terminal ? { endedAt: now } : {}),
        },
      }),
    );
  },

  async setPlanHash(id: string, planHash: string): Promise<void> {
    await prisma.run.update({ where: { id }, data: { planHash } });
  },

  async attachSession(id: string, sessionId: string, liveViewUrl: string | null): Promise<void> {
    await prisma.run.update({
      where: { id },
      data: { browserSessionId: sessionId, liveViewUrl },
    });
  },

  async fail(id: string, code: string, detail: Record<string, unknown>): Promise<RunRecord> {
    return toRun(
      await prisma.run.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorCode: code,
          errorDetail: detail as Prisma.InputJsonValue,
          endedAt: new Date(),
        }, // Prisma requires InputJsonValue for json fields
      }),
    );
  },

  /**
   * Spend is accumulated with a SQL-side increment rather than read-modify-write. The
   * budget governor and the LLM router can both be writing concurrently, and a lost
   * update here means a run quietly exceeding the limit the user set.
   */
  async addSpend(
    id: string,
    costMicroUsd: number,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "Run"
         SET "spentUsd"     = "spentUsd" + ${microUsdToDecimalString(costMicroUsd)}::decimal,
             "inputTokens"  = "inputTokens" + ${inputTokens},
             "outputTokens" = "outputTokens" + ${outputTokens}
       WHERE "id" = ${id}`;
  },

  /** Powers both the usage page and the per-agent cost line items in the UI. */
  async costBreakdown(id: string): Promise<RunCostBreakdown> {
    const rows = await prisma.llmCall.groupBy({
      by: ['agent'],
      where: { runId: id },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true, cachedTokens: true },
      _count: { _all: true },
    });

    const byAgent = rows.map((r) => {
      return {
        agent: r.agent,
        microUsd: decimalToMicroUsdSafe(r._sum.costUsd),
        callCount: Number(r._count._all),
      };
    });

    const totals = rows.reduce<Omit<RunCostBreakdown, 'byAgent'>>(
      (acc, raw) => {
        const r = raw as {
          _sum: {
            costUsd: unknown;
            inputTokens: number | null;
            outputTokens: number | null;
            cachedTokens: number | null;
          };
          _count: { _all: number };
        };
        return {
          totalMicroUsd: acc.totalMicroUsd + decimalToMicroUsdSafe(r._sum.costUsd),
          inputTokens: acc.inputTokens + Number(r._sum.inputTokens ?? 0),
          outputTokens: acc.outputTokens + Number(r._sum.outputTokens ?? 0),
          cachedTokens: acc.cachedTokens + Number(r._sum.cachedTokens ?? 0),
          callCount: acc.callCount + Number(r._count._all),
        };
      },
      { totalMicroUsd: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, callCount: 0 },
    );

    return { ...totals, byAgent: byAgent.sort((a, b) => b.microUsd - a.microUsd) };
  },

  async countActiveForOrg(orgId: string): Promise<number> {
    const active: RunStatus[] = [
      'PLANNING',
      'AWAITING_APPROVAL',
      'EXECUTING',
      'VERIFYING',
      'CRITIQUE',
      'RECOVERING',
      'PAUSED',
      'TAKEOVER',
      'FORMATTING',
    ];
    return Number(await prisma.run.count({ where: { orgId, status: { in: active } } }));
  },

  async setMode(id: string, mode: AutonomyMode): Promise<void> {
    await prisma.run.update({ where: { id }, data: { mode } });
  },
};

/** Prisma aggregate sums are nullable when no rows matched the grouping. */
function decimalToMicroUsdSafe(value: unknown): number {
  return decimalToMicroUsd(value);
}

export type RunRepository = typeof runRepository;
