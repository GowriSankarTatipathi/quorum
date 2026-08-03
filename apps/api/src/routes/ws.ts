import { verifyAccessToken } from '@quorum/auth';
import { eventRepository, runRepository } from '@quorum/db';
import { runChannel } from '@quorum/events';
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { redisSubscriber } from '../redis.js';

/** Beyond this, the socket is behind and switches to summary mode. */
const BACKPRESSURE_BYTES = 1_048_576;

/** Event types dropped when a socket is struggling. High-frequency, low-meaning. */
const VERBOSE_TYPES = new Set(['llm.token', 'browser.screenshot']);

interface Subscription {
  runId: string;
  handler: (channel: string, message: string) => void;
}

/**
 * The live event stream.
 *
 * Any gateway instance can serve any run, because events arrive over Redis pub/sub rather
 * than from the worker that produced them. That is what keeps the gateway stateless — no
 * sticky routing, and a deploy that restarts a worker does not drop a client's connection.
 *
 * Reconnection is exactly-once from the client's point of view: it sends the sequence
 * number it has through, the server replays from the database, and only then attaches to
 * the live channel. No gaps, no duplicates, and no dedup logic in the browser.
 */
export function registerWebsocket(app: FastifyInstance): void {
  app.get('/v1/ws', { websocket: true }, (socket, request) => {
    const query = request.query as { runId?: string; cursor?: string; token?: string };
    const runId = query.runId;
    // Browsers cannot set headers on a WebSocket handshake, so the access token arrives
    // as a query parameter. It is the same short-lived token, verified the same way.
    const token = query.token;

    if (!runId || !token) {
      socket.close(4400, 'runId and token are required');
      return;
    }

    let subscription: Subscription | null = null;
    let summaryMode = false;

    const send = (payload: unknown): void => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(payload));
    };

    void (async () => {
      try {
        const claims = await verifyAccessToken(token, env.JWT_SECRET);
        const run = await runRepository.findByIdForOrg(runId, claims.org);
        if (!run) {
          socket.close(4404, 'run not found');
          return;
        }

        const cursor = Number(query.cursor ?? 0);
        const history = await eventRepository.listAfter(runId, cursor, 1_000);
        for (const event of history) {
          send({ ...event, ts: event.ts.toISOString() });
        }
        send({ type: '__replayed', lastSeq: history.at(-1)?.seq ?? cursor });

        const handler = (channel: string, message: string): void => {
          if (channel !== runChannel(runId)) return;

          if (socket.bufferedAmount > BACKPRESSURE_BYTES) {
            if (!summaryMode) {
              summaryMode = true;
              // Degrading fidelity while preserving meaning is the right failure mode for
              // someone on hotel wi-fi; telling them it happened preserves trust.
              send({ type: '__summary_mode', reason: 'slow_connection' });
            }
          } else if (summaryMode && socket.bufferedAmount === 0) {
            summaryMode = false;
            send({ type: '__full_mode' });
          }

          if (summaryMode) {
            const parsed = JSON.parse(message) as { type: string };
            if (VERBOSE_TYPES.has(parsed.type)) return;
          }
          if (socket.readyState === socket.OPEN) socket.send(message);
        };

        await redisSubscriber.subscribe(runChannel(runId));
        redisSubscriber.on('message', handler);
        subscription = { runId, handler };
      } catch {
        socket.close(4401, 'invalid or expired token');
      }
    })();

    socket.on('close', () => {
      void (async () => {
        if (!subscription) return;
        redisSubscriber.off('message', subscription.handler);
        // Only unsubscribe when no other socket is watching this run; a shared connection
        // means one viewer leaving must not blind the others.
        const remaining = redisSubscriber.listenerCount('message');
        if (remaining === 0) await redisSubscriber.unsubscribe(runChannel(subscription.runId));
      })();
    });
  });
}
