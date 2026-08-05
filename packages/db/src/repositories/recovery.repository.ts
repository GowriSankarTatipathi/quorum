
import { prisma } from '../client.js';
import { microUsdToDecimalString } from '../money.js';
import type { RecoveryAttemptRecord } from '../types.js';
import { toRecoveryAttempt } from './runtime-mappers.js';

export interface CreateRecoveryAttemptInput {
  stepId: string;
  attempt: number;
  errorCode: string;
  errorClass: string;
  strategy: string;
  rationale?: string | null;
  expectedOutcome?: string | null;
  costMicroUsd?: number;
}

export const recoveryRepository = {
  async record(input: CreateRecoveryAttemptInput): Promise<RecoveryAttemptRecord> {
    const row = await prisma.recoveryAttempt.create({
      data: {
        stepId: input.stepId,
        attempt: input.attempt,
        errorCode: input.errorCode,
        errorClass: input.errorClass,
        strategy: input.strategy,
        rationale: input.rationale ?? null,
        expectedOutcome: input.expectedOutcome ?? null,
        costUsd: microUsdToDecimalString(input.costMicroUsd ?? 0),
      },
    });
    return toRecoveryAttempt(row);
  },

  async markOutcome(id: string, succeeded: boolean): Promise<void> {
    await prisma.recoveryAttempt.update({ where: { id }, data: { succeeded } });
  },

  /** Fed back to the Recovery agent so it never repeats a strategy already tried. */
  async listForStep(stepId: string): Promise<RecoveryAttemptRecord[]> {
    const rows: unknown[] = await prisma.recoveryAttempt.findMany({
      where: { stepId },
      orderBy: { attempt: 'asc' },
    });
    return rows.map((r) => toRecoveryAttempt(r as Record<string, unknown>));
  },

  async countForRun(runId: string): Promise<number> {
    return Number(await prisma.recoveryAttempt.count({ where: { step: { runId } } }));
  },

  /**
   * Recovery success rate by error class. This is how the ladder gets tuned with
   * evidence: a strategy that never works for a given class should not stay on the
   * rung above one that does.
   */
  async successRateByClass(
    since: Date,
  ): Promise<{ errorClass: string; strategy: string; attempts: number; successes: number }[]> {
    const rows = await prisma.recoveryAttempt.groupBy({
      by: ['errorClass', 'strategy'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });
    const successes = await prisma.recoveryAttempt.groupBy({
      by: ['errorClass', 'strategy'],
      where: { createdAt: { gte: since }, succeeded: true },
      _count: { _all: true },
    });

    const successCount = new Map<string, number>();
    for (const r of successes) {
      successCount.set(`${r.errorClass}::${r.strategy}`, Number(r._count._all));
    }

    return rows.map((r) => {
      return {
        errorClass: r.errorClass,
        strategy: r.strategy,
        attempts: Number(r._count._all),
        successes: successCount.get(`${r.errorClass}::${r.strategy}`) ?? 0,
      };
    });
  },
};

export type RecoveryRepository = typeof recoveryRepository;
