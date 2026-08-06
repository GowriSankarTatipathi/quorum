import type { StepStatus } from '@quorum/core';
import { type Prisma } from '../../generated/client/index.js';
import { prisma } from '../client.js';
import { microUsdToDecimalString } from '../money.js';
import type { CreateStepInput, StepRecord } from '../types.js';
import { toStep } from './runtime-mappers.js';

export const stepRepository = {
  /** The whole plan is written in one transaction: a half-inserted plan is not a plan. */
  async createMany(runId: string, steps: readonly CreateStepInput[]): Promise<StepRecord[]> {
    const created: unknown[] = await prisma.$transaction(
      steps.map((step) =>
        prisma.step.create({
          data: {
            runId,
            index: step.index,
            objective: step.objective,
            targetUrl: step.targetUrl ?? null,
            agentPath: step.agentPath ?? [],
            outputSchema: (step.outputSchema ?? undefined) as Prisma.InputJsonValue | undefined, // Prisma requires InputJsonValue for json fields
            riskLevel: step.riskLevel ?? 'LOW',
            notes: step.notes ?? null,
            estimatedMs: step.estimatedMs ?? null,
            estimatedUsd:
              step.estimatedMicroUsd == null
                ? null
                : microUsdToDecimalString(step.estimatedMicroUsd),
          },
        }),
      ),
    );
    return created.map((r) => toStep(r as Record<string, unknown>));
  },

  async listForRun(runId: string): Promise<StepRecord[]> {
    const rows: unknown[] = await prisma.step.findMany({
      where: { runId },
      orderBy: { index: 'asc' },
    });
    return rows.map((r) => toStep(r as Record<string, unknown>));
  },

  async findById(id: string): Promise<StepRecord | null> {
    const row = await prisma.step.findUnique({ where: { id } });
    return row ? toStep(row) : null;
  },

  async findByIndex(runId: string, index: number): Promise<StepRecord | null> {
    const row = await prisma.step.findUnique({ where: { runId_index: { runId, index } } });
    return row ? toStep(row) : null;
  },

  async start(id: string): Promise<StepRecord> {
    return toStep(
      await prisma.step.update({
        where: { id },
        data: { status: 'RUNNING', startedAt: new Date(), attempt: { increment: 1 } },
      }),
    );
  },

  async finish(id: string, status: StepStatus, actualMs: number): Promise<StepRecord> {
    return toStep(
      await prisma.step.update({
        where: { id },
        data: { status, actualMs, endedAt: new Date() },
      }),
    );
  },

  async setStatus(id: string, status: StepStatus): Promise<void> {
    await prisma.step.update({ where: { id }, data: { status } });
  },

  /**
   * Plan editing uses patch semantics. Regenerating is non-deterministic and discards
   * the parts the user already approved, so a correction changes only what was edited.
   */
  async patch(
    id: string,
    patch: Partial<Pick<CreateStepInput, 'objective' | 'targetUrl' | 'notes' | 'riskLevel'>>,
  ): Promise<StepRecord> {
    return toStep(await prisma.step.update({ where: { id }, data: patch }));
  },
};

export type StepRepository = typeof stepRepository;
