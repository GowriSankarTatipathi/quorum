import { prisma } from '../client.js';
import type { CreateEventInput, EventRecord } from '../types.js';
import { toEvent } from './runtime-mappers.js';

export const eventRepository = {
  /**
   * Persist-then-publish. Every event is written here before it is published to Redis,
   * so a Redis failure costs live latency and never loses history. The database is the
   * replay source of truth; the message bus is only transport.
   */
  async append(input: CreateEventInput): Promise<EventRecord> {
    const row = await prisma.event.create({
      data: {
        id: input.id,
        runId: input.runId,
        seq: BigInt(input.seq),
        type: input.type,
        agent: input.agent ?? null,
        stepId: input.stepId ?? null,
        payload: input.payload ?? {},
        causationId: input.causationId ?? null,
        correlationId: input.correlationId ?? null,
      },
    });
    return toEvent(row);
  },

  /**
   * A fast agent emits 20–40 events per second. Batching the writes keeps the run loop
   * from waiting on a round trip per event; `skipDuplicates` makes a retried batch
   * idempotent, since ids are minted client-side before the insert.
   */
  async appendMany(inputs: readonly CreateEventInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await prisma.event.createMany({
      data: inputs.map((input) => ({
        id: input.id,
        runId: input.runId,
        seq: BigInt(input.seq),
        type: input.type,
        agent: input.agent ?? null,
        stepId: input.stepId ?? null,
        payload: input.payload ?? {},
        causationId: input.causationId ?? null,
        correlationId: input.correlationId ?? null,
      })),
      skipDuplicates: true,
    });
    return Number((result as { count: unknown }).count);
  },

  /**
   * Cursor pagination for WebSocket reconnection: the client says "I have through N",
   * the server replays N+1 onward and then attaches to the live stream. No gaps, no
   * duplicates, and no dedup logic in the client.
   */
  async listAfter(runId: string, afterSeq: number, limit = 500): Promise<EventRecord[]> {
    const rows: unknown[] = await prisma.event.findMany({
      where: { runId, seq: { gt: BigInt(afterSeq) } },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((r) => toEvent(r as Record<string, unknown>));
  },

  async listForRun(runId: string, limit = 2000): Promise<EventRecord[]> {
    const rows: unknown[] = await prisma.event.findMany({
      where: { runId },
      orderBy: { seq: 'asc' },
      take: limit,
    });
    return rows.map((r) => toEvent(r as Record<string, unknown>));
  },

  async listByType(runId: string, types: readonly string[]): Promise<EventRecord[]> {
    const rows: unknown[] = await prisma.event.findMany({
      where: { runId, type: { in: [...types] } },
      orderBy: { seq: 'asc' },
    });
    return rows.map((r) => toEvent(r as Record<string, unknown>));
  },

  /** Rehydrates the sequence counter so a resumed run continues rather than restarting
   *  it, which would invalidate every connected client's cursor. */
  async lastSeq(runId: string): Promise<number> {
    const row = await prisma.event.findFirst({
      where: { runId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return row ? Number((row as { seq: bigint }).seq) : 0;
  },

  async countForRun(runId: string): Promise<number> {
    return Number(await prisma.event.count({ where: { runId } }));
  },
};

export type EventRepository = typeof eventRepository;
