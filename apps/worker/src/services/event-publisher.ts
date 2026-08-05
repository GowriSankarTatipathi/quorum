import { newId } from '@quorum/core';
import { eventRepository } from '@quorum/db';
import {
  SequenceCounter,
  createEvent,
  runChannel,
  TRANSIENT_EVENTS,
  type EventContext,
  type RunEventPayloads,
  type RunEventType,
} from '@quorum/events';
import { logger } from '../logger.js';
import { publisher } from '../redis.js';

/**
 * Persist-then-publish.
 *
 * Every event is written to Postgres before it is published to Redis, so a Redis outage
 * costs live latency and never loses history: the database is the replay source of
 * truth and the bus is only transport. Publishing first would make the UI show events
 * that no audit trail contains, which is the wrong failure to have in this product.
 *
 * Transient events are published but not persisted.
 */
export class EventPublisher {
  private readonly counter = new SequenceCounter();

  /** Continues the sequence after a worker restart so client cursors stay valid. */
  async resume(runId: string): Promise<void> {
    this.counter.seed(runId, await eventRepository.lastSeq(runId));
  }

  async emit<T extends RunEventType>(
    type: T,
    payload: RunEventPayloads[T],
    ctx: EventContext,
  ): Promise<void> {
    const event = createEvent(type, payload, ctx, this.counter.next(ctx.runId));

    if (!TRANSIENT_EVENTS.has(type)) {
      await eventRepository.append({
        id: event.id,
        runId: event.runId,
        seq: event.seq,
        type: event.type,
        agent: event.agent,
        stepId: event.stepId,
        payload: event.payload,
        causationId: event.causationId,
        correlationId: event.correlationId,
      });
    }

    try {
      await publisher.publish(runChannel(event.runId), JSON.stringify(event));
    } catch (error) {
      // The event is durable at this point; a failed publish degrades live streaming for
      // connected clients and is recovered by their reconnect cursor.
      logger.warn({ err: error, runId: event.runId, type }, 'event published to db but not to bus');
    }
  }

  release(runId: string): void {
    this.counter.release(runId);
  }
}

export const eventPublisher = new EventPublisher();

/** Correlation ids group one agent turn so the UI can collapse it into a single card. */
export const newCorrelation = (): string => newId();
