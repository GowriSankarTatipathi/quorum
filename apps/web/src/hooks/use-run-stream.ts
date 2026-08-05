'use client';

import { useEffect, useRef } from 'react';
import { clientEnv } from '@/lib/env';
import { useRunStore, type StreamEvent } from '@/stores/run-store';

/** Coalescing window. A fast agent emits 20–40 events per second; committing each one
 *  individually re-renders a large tree that often. */
const FLUSH_MS = 60;

/**
 * The live event stream.
 *
 * Two decisions carry this hook. Events are buffered and flushed on an animation frame,
 * because 40 store commits per second is 40 renders per second and the difference between
 * "premium" and "janky" is about twelve lines of batching. And reconnection carries the
 * sequence number the client already has, so the server replays from there — a laptop
 * closed mid-run and reopened is a supported path, not an accident, because it is the most
 * common thing that happens during a three-minute task.
 */
export function useRunStream(runId: string, accessToken: string | null): void {
  const buffer = useRef<StreamEvent[]>([]);
  const frame = useRef<number | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    if (!accessToken) {
      useRunStore.getState().setConnectionState('auth_failed', null, 'No active session');
      return;
    }
    closed.current = false;

    const flush = (): void => {
      frame.current = null;
      if (buffer.current.length === 0) return;
      const batch = buffer.current;
      buffer.current = [];
      useRunStore.getState().applyBatch(batch);
    };

    const schedule = (): void => {
      if (frame.current !== null) return;
      frame.current = window.setTimeout(flush, FLUSH_MS);
    };

    let backoff = 500;
    
    const pollRest = async (): Promise<void> => {
      if (closed.current) return;
      const cursor = useRunStore.getState().lastSeq;
      try {
        const url = `${clientEnv.apiUrl}/v1/runs/${runId}/events?after=${cursor}&limit=500`;
        const res = await fetch(url, {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          useRunStore.getState().setFallbackMode(true);
          const data = (await res.json()) as { events: StreamEvent[] };
          if (data.events.length > 0) {
            useRunStore.getState().applyBatch(data.events);
          }
        } else if (res.status === 401 || res.status === 403) {
          useRunStore.getState().setConnectionState('auth_failed', res.status, 'Session expired');
        }
      } catch (_err) {
        // If the REST endpoint fails, log it locally but keep trying.
        console.warn('Failed to poll events; retrying in 2s');
      }
    };

    const connect = (): void => {
      if (closed.current) return;
      const cursor = useRunStore.getState().lastSeq;
      const url = `${clientEnv.wsUrl}?runId=${encodeURIComponent(runId)}&cursor=${String(cursor)}&token=${encodeURIComponent(accessToken)}`;
      useRunStore.getState().setConnectionState('connecting');
      const ws = new WebSocket(url);
      socket.current = ws;

      ws.onopen = () => {
        backoff = 500;
        useRunStore.getState().setFallbackMode(false);
        useRunStore.getState().setConnectionState('connected');
      };

      ws.onmessage = (message: MessageEvent<string>) => {
        const parsed = JSON.parse(message.data) as StreamEvent & { type: string };
        // Control frames from the gateway, not run events.
        if (parsed.type === '__summary_mode') {
          useRunStore.getState().setSummaryMode(true);
          return;
        }
        if (parsed.type === '__full_mode') {
          useRunStore.getState().setSummaryMode(false);
          return;
        }
        if (parsed.type === '__replayed') return;

        buffer.current.push(parsed);
        schedule();
      };

      ws.onclose = (event: CloseEvent) => {
        if (closed.current) return;
        
        if (event.code === 4401 || event.code === 4404 || event.code === 4400) {
          useRunStore.getState().setConnectionState('auth_failed', event.code, event.reason);
          return;
        }

        useRunStore.getState().setConnectionState('disconnected', event.code, event.reason);
        
        void pollRest();
        
        backoff = Math.min(backoff * 2, 10_000);
        window.setTimeout(connect, backoff);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      closed.current = true;
      if (frame.current !== null) window.clearTimeout(frame.current);
      flush();
      socket.current?.close();
      socket.current = null;
    };
  }, [runId, accessToken]);
}
