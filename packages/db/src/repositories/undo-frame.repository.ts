import { prisma } from '../client.js';
import type { UndoFrameRecord } from '../types.js';
import { toUndoFrame } from './runtime-mappers.js';

export interface CreateUndoFrameInput {
  stepId: string;
  seq: number;
  url: string;
  scrollY: number;
  domSnapshotKey: string;
  screenshotKey: string;
  cookiesKey?: string | null;
  reversible: boolean;
}

export const undoFrameRepository = {
  async capture(input: CreateUndoFrameInput): Promise<UndoFrameRecord> {
    const row = await prisma.undoFrame.create({
      data: {
        stepId: input.stepId,
        seq: input.seq,
        url: input.url,
        scrollY: input.scrollY,
        domSnapshotKey: input.domSnapshotKey,
        screenshotKey: input.screenshotKey,
        cookiesKey: input.cookiesKey ?? null,
        reversible: input.reversible,
      },
    });
    return toUndoFrame(row);
  },

  /** The frame ⌘Z would restore. Null when there is nothing to undo. */
  async latestForRun(runId: string): Promise<UndoFrameRecord | null> {
    const row = await prisma.undoFrame.findFirst({
      where: { step: { runId } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toUndoFrame(row) : null;
  },

  async listForStep(stepId: string): Promise<UndoFrameRecord[]> {
    const rows: unknown[] = await prisma.undoFrame.findMany({
      where: { stepId },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r) => toUndoFrame(r as Record<string, unknown>));
  },

  async nextSeq(stepId: string): Promise<number> {
    const row = await prisma.undoFrame.findFirst({
      where: { stepId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return row ? Number((row).seq) + 1 : 0;
  },

  /**
   * Once a step commits something irreversible, every earlier frame in that step becomes
   * unusable too: restoring the page would not un-send what was sent, and offering undo
   * that silently does less than it claims is worse than refusing honestly.
   */
  async markStepIrreversible(stepId: string): Promise<void> {
    await prisma.undoFrame.updateMany({ where: { stepId }, data: { reversible: false } });
  },
};

export type UndoFrameRepository = typeof undoFrameRepository;
