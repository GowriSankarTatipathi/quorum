import { prisma } from '../client.js';
import { decimalToMicroUsd, microUsdToDecimalString } from '../money.js';
import type { CreateLlmCallInput, LlmCallRecord } from '../types.js';
import { toLlmCall } from './runtime-mappers.js';

export const llmCallRepository = {
  async record(input: CreateLlmCallInput): Promise<LlmCallRecord> {
    const row = await prisma.llmCall.create({
      data: {
        runId: input.runId,
        stepId: input.stepId ?? null,
        agent: input.agent,
        model: input.model,
        promptVersion: input.promptVersion,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        cachedTokens: input.cachedTokens ?? 0,
        costUsd: microUsdToDecimalString(input.costMicroUsd),
        latencyMs: input.latencyMs,
        cached: input.cached ?? false,
        fallbackUsed: input.fallbackUsed ?? false,
        schemaViolation: input.schemaViolation ?? false,
      },
    });
    return toLlmCall(row);
  },

  async listForRun(runId: string): Promise<LlmCallRecord[]> {
    const rows: unknown[] = await prisma.llmCall.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toLlmCall(r as Record<string, unknown>));
  },

  /**
   * Quality regression triage. When the verified-extraction rate drops after a deploy,
   * this is the query that turns a week of guessing into one comparison — which is the
   * entire reason `promptVersion` is stored on every call.
   */
  async statsByPromptVersion(
    agent: string,
    since: Date,
  ): Promise<
    { promptVersion: string; model: string; calls: number; violations: number; microUsd: number }[]
  > {
    const rows: unknown[] = await prisma.llmCall.groupBy({
      by: ['promptVersion', 'model'],
      where: { agent, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { costUsd: true },
    });

    const violations: unknown[] = await prisma.llmCall.groupBy({
      by: ['promptVersion', 'model'],
      where: { agent, createdAt: { gte: since }, schemaViolation: true },
      _count: { _all: true },
    });

    const violationCount = new Map<string, number>();
    for (const raw of violations) {
      const r = raw as { promptVersion: string; model: string; _count: { _all: number } };
      violationCount.set(`${r.promptVersion}::${r.model}`, Number(r._count._all));
    }

    return rows.map((raw) => {
      const r = raw as {
        promptVersion: string;
        model: string;
        _count: { _all: number };
        _sum: { costUsd: unknown };
      };
      return {
        promptVersion: r.promptVersion,
        model: r.model,
        calls: Number(r._count._all),
        violations: violationCount.get(`${r.promptVersion}::${r.model}`) ?? 0,
        microUsd: decimalToMicroUsd(r._sum.costUsd),
      };
    });
  },

  /** Cache-hit savings, shown on the usage page so the number is credible. */
  async cacheSavings(runId: string): Promise<{ hits: number; savedMicroUsd: number }> {
    const rows: unknown[] = await prisma.llmCall.findMany({
      where: { runId, cached: true },
      select: { costUsd: true },
    });
    return {
      hits: rows.length,
      savedMicroUsd: rows.reduce<number>(
        (sum, raw) => sum + decimalToMicroUsd((raw as { costUsd: unknown }).costUsd),
        0,
      ),
    };
  },
};

export type LlmCallRepository = typeof llmCallRepository;
