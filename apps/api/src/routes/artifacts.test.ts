import { join } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FilesystemStorage } from '@quorum/storage';

import type * as EnvModule from '../env.js';

vi.mock('../env.js', async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: {
      ...actual.env,
      ARTIFACT_ROOT: '/tmp/quorum-artifacts-test',
      API_ORIGIN: 'http://localhost:3001',
    },
  };
});

vi.mock('../services/storage.js', () => {
  const store = new FilesystemStorage({
    root: '/tmp/quorum-artifacts-test',
    publicBaseUrl: 'http://localhost:3001/v1/artifacts',
    signingSecret: 'test-secret',
  });
  return {
    getStorage: () => store,
    hasStorage: () => true,
  };
});

// Mock other services required by buildApp
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
    defineCommand() {}
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
  userRepository: {},
  orgRepository: {},
}));

vi.mock('@quorum/auth', () => ({
  verifyAccessToken: () => Promise.resolve({ sub: 'u', org: 'o', ver: 1, role: 'ADMIN' }),
  capabilitiesFromClaims: () => ({ permissions: new Set(), canApproveAnything: false }),
  AuthError: class extends Error {},
}));

import { buildApp } from '../app.js';

describe('GET /v1/artifacts', () => {
  let app: FastifyInstance;
  let store: FilesystemStorage;

  beforeAll(async () => {
    await mkdir('/tmp/quorum-artifacts-test', { recursive: true });
    await writeFile(join('/tmp/quorum-artifacts-test', 'test.txt'), 'hello world');
    await writeFile(join('/tmp/quorum-artifacts-test', 'test.png'), 'fake-png-data');
    
    app = await buildApp();
    await app.ready();
    
    store = new FilesystemStorage({
      root: '/tmp/quorum-artifacts-test',
      publicBaseUrl: 'http://localhost:3001/v1/artifacts',
      signingSecret: 'test-secret',
    });
  });

  afterAll(async () => {
    await app.close();
    await rm('/tmp/quorum-artifacts-test', { recursive: true, force: true });
  });

  it('serves a file with a valid signature', async () => {
    const signedUrl = await store.signedUrl('test.txt', 3600);
    const pathAndQuery = signedUrl.replace('http://localhost:3001', '');

    const response = await app.inject({
      method: 'GET',
      url: pathAndQuery,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('hello world');
    expect(response.headers['content-type']).toBe('application/octet-stream');
  });

  it('sets content-type based on extension and content-disposition from filename', async () => {
    const signedUrl = await store.signedUrl('test.png', 3600, 'download.png');
    const pathAndQuery = signedUrl.replace('http://localhost:3001', '');

    const response = await app.inject({
      method: 'GET',
      url: pathAndQuery,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('fake-png-data');
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['content-disposition']).toBe('attachment; filename="download.png"');
  });

  it('returns 403 for tampered signature', async () => {
    const signedUrl = await store.signedUrl('test.txt', 3600);
    const url = new URL(signedUrl);
    url.searchParams.set('signature', 'invalid-signature-123');
    
    const response = await app.inject({
      method: 'GET',
      url: `${url.pathname}${url.search}`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('E_FORBIDDEN');
  });

  it('returns 410 for expired signature', async () => {
    const signedUrl = await store.signedUrl('test.txt', -100);
    const pathAndQuery = signedUrl.replace('http://localhost:3001', '');

    const response = await app.inject({
      method: 'GET',
      url: pathAndQuery,
    });

    expect(response.statusCode).toBe(410);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('E_GONE');
  });

  it('returns 403 for path traversal attempts', async () => {
    const key = '../outside.txt';
    const signedUrl = await store.signedUrl(key, 3600);
    const pathAndQuery = signedUrl.replace('http://localhost:3001', '');

    const response = await app.inject({
      method: 'GET',
      url: pathAndQuery,
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 404 for missing file with valid signature', async () => {
    const signedUrl = await store.signedUrl('does-not-exist.txt', 3600);
    const pathAndQuery = signedUrl.replace('http://localhost:3001', '');

    const response = await app.inject({
      method: 'GET',
      url: pathAndQuery,
    });

    expect(response.statusCode).toBe(404);
  });
});
