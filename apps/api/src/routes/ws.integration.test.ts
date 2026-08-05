import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { eventRepository, runRepository } from '@quorum/db';
import { verifyAccessToken } from '@quorum/auth';
import { redisSubscriber } from '../redis.js';

// ── External dependency stubs ──────────────────────────────────────────────────
vi.mock('ioredis', async () => {
  const { EventEmitter } = await import('node:events');
  class MockRedis extends EventEmitter {
    status = 'ready';
    ping() { return Promise.resolve('PONG'); }
    quit() { return Promise.resolve(); }
    subscribe() { return Promise.resolve(); }
    unsubscribe() { return Promise.resolve(); }
    lpush() { return Promise.resolve(1); }
    expire() { return Promise.resolve(1); }
    get() { return Promise.resolve(null); }
    set() { return Promise.resolve('OK'); }
    del() { return Promise.resolve(1); }
    incr() { return Promise.resolve(1); }
    pttl() { return Promise.resolve(-1); }
    defineCommand() { }
    rlflxFixed() { return Promise.resolve([0, 0]); }
    rlflxSliding() { return Promise.resolve([0, 0]); }
    call() { return Promise.resolve(null); }
    disconnect() { return; }
  }
  return { Redis: MockRedis, default: MockRedis };
});

vi.mock('bullmq', () => {
  class MockQueue {
    add() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  return { Queue: MockQueue };
});

vi.mock('@quorum/db', () => ({
  checkDatabase: () => Promise.resolve({ ok: true, latencyMs: 1 }),
  orgRepository: {},
  userRepository: {},
  runRepository: {
    findByIdForOrg: vi.fn(),
  },
  stepRepository: {},
  claimRepository: {},
  eventRepository: {
    listAfter: vi.fn(),
  },
  approvalRepository: {},
  critiqueRepository: {},
  artifactRepository: {},
  authEventRepository: {},
}));

vi.mock('@quorum/auth', () => ({
  verifyAccessToken: vi.fn(),
  capabilitiesFromClaims: () => ({
    permissions: new Set(),
    approvalCeiling: null,
    canApproveAnything: false,
  }),
  claimsCanApprove: () => true,
  accountDisabled: () => false,
  staleTokenVersion: () => false,
  tokenRevoked: () => false,
  AuthError: class extends Error {},
}));

vi.mock('@quorum/auth/server', () => ({
  AccessTokenDenylist: class {
    isRevoked() { return Promise.resolve(false); }
  },
}));

vi.mock('@quorum/storage', () => ({
  ArtifactStorage: class {
    signedUrl() { return Promise.resolve('https://example.com/signed'); }
  },
  downloadFilename: () => 'export.xlsx',
}));

// ── Test ────────────────────────────────────────────────────────────────────────

describe('WebSocket /v1/ws Integration', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (typeof address === 'object' && address !== null) {
      port = address.port;
    } else {
      throw new Error('Failed to bind to a port');
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects connection if token is missing', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?runId=run123`);
    const code = await new Promise<number>((resolve) => {
      ws.addEventListener('close', (event) => resolve(event.code));
    });
    expect(code).toBe(4400);
  });

  it('rejects connection if runId is missing', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?token=mock_token`);
    const code = await new Promise<number>((resolve) => {
      ws.addEventListener('close', (event) => resolve(event.code));
    });
    expect(code).toBe(4400);
  });

  it('rejects connection if token is invalid', async () => {
    vi.mocked(verifyAccessToken).mockRejectedValueOnce(new Error('Invalid token'));
    
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?runId=run123&token=invalid`);
    const code = await new Promise<number>((resolve) => {
      ws.addEventListener('close', (event) => resolve(event.code));
    });
    expect(code).toBe(4401);
  });

  it('rejects connection if run is not found or not in org', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValueOnce({ sub: 'user_1', org: 'org_1', role: 'ADMIN' } as Awaited<ReturnType<typeof verifyAccessToken>>);
    vi.mocked(runRepository).findByIdForOrg.mockResolvedValueOnce(null);
    
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?runId=run123&token=valid`);
    const code = await new Promise<number>((resolve) => {
      ws.addEventListener('close', (event) => resolve(event.code));
    });
    expect(code).toBe(4404);
  });

  it('connects, replays events, and forwards pubsub messages', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({ sub: 'user_1', org: 'org_1', role: 'ADMIN' } as Awaited<ReturnType<typeof verifyAccessToken>>);
    vi.mocked(runRepository).findByIdForOrg.mockResolvedValue({ id: 'run123' } as Awaited<ReturnType<typeof runRepository.findByIdForOrg>>);
    
    const mockEvents = [
      { id: 'e1', seq: 1, type: 'agent.started', ts: new Date() },
      { id: 'e2', seq: 2, type: 'browser.started', ts: new Date() },
    ];
    vi.mocked(eventRepository).listAfter.mockResolvedValue(mockEvents as Awaited<ReturnType<typeof eventRepository.listAfter>>);
    
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?runId=run123&token=valid&cursor=0`);
    
    const messages: Array<{ type: string; lastSeq?: number; seq?: number }> = [];
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('message', (event) => {
        const data = event.data as string;
        const parsed = JSON.parse(data) as { type: string; lastSeq?: number; seq?: number };
        messages.push(parsed);
        if (parsed.type === '__replayed') {
          resolve();
        }
      });
      ws.addEventListener('error', reject);
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]?.type).toBe('agent.started');
    expect(messages[1]?.type).toBe('browser.started');
    expect(messages[2]?.type).toBe('__replayed');
    expect(messages[2]?.lastSeq).toBe(2);

    // Now test real-time event forwarding via Redis mock
    const liveEvent = { id: 'e3', seq: 3, type: 'agent.stopped' };
    
    const messagePromise = new Promise<{ type: string; seq?: number }>((resolve) => {
      ws.addEventListener('message', (event) => {
        const data = event.data as string;
        const parsed = JSON.parse(data) as { type: string; seq?: number };
        resolve(parsed);
      });
    });

    // Simulate Redis publish
    redisSubscriber.emit('message', 'run:run123:events', JSON.stringify(liveEvent));

    const receivedLiveEvent = await messagePromise;
    expect(receivedLiveEvent.type).toBe('agent.stopped');
    expect(receivedLiveEvent.seq).toBe(3);

    ws.close();
  });

  it('maintains connection stability without abnormal closure (10s)', async () => {
    vi.mocked(verifyAccessToken).mockResolvedValue({ sub: 'user_1', org: 'org_1', role: 'ADMIN' } as Awaited<ReturnType<typeof verifyAccessToken>>);
    vi.mocked(runRepository).findByIdForOrg.mockResolvedValue({ id: 'run_stable' } as Awaited<ReturnType<typeof runRepository.findByIdForOrg>>);
    vi.mocked(eventRepository).listAfter.mockResolvedValue([]);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/ws?runId=run_stable&token=valid`);

    let closed = false;
    ws.addEventListener('close', () => { closed = true; });

    // Wait for connection to open and then hold for 10 seconds
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('WebSocket error')));
    });

    await new Promise((r) => setTimeout(r, 10000));

    expect(closed).toBe(false);
    expect(ws.readyState).toBe(ws.OPEN);
    
    ws.close();
  }, 15000); // Give the test up to 15s timeout
});
