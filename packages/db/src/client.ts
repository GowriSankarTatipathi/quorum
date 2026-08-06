import { PrismaClient } from '../generated/client/index.js';

/**
 * A single PrismaClient per process, constructed lazily.
 *
 * Lazy for two reasons. Importing `@quorum/db` for a *type* — which the API does in
 * several modules — should not open a connection pool, and a process that never queries
 * (a build step, a CLI, a test that only exercises route guards) should not require a
 * generated client to exist. Deferring construction to first use makes the dependency
 * honest: you pay for the database exactly when you touch it.
 *
 * Next.js dev-mode hot reload re-evaluates modules on every edit, so the instance is
 * cached on `globalThis`; without that, each save opens a new pool and the database
 * exhausts its connections within a minute.
 */
const globalForPrisma = globalThis as typeof globalThis & { quorumPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const logLevels =
    process.env.NODE_ENV === 'production'
      ? (['error', 'warn'] as const)
      : (['query', 'error', 'warn'] as const);
  return new PrismaClient({ log: [...logLevels] });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.quorumPrisma) globalForPrisma.quorumPrisma = createClient();
  return globalForPrisma.quorumPrisma;
}

/** Behaves exactly like a PrismaClient; the underlying client is created on first use. */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getClient();
    const value: unknown = Reflect.get(client, property, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
  has(_target, property) {
    return property in getClient();
  },
});

/** Dependency probe used by /readyz on both the API and the worker. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await getClient().$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

export async function disconnect(): Promise<void> {
  if (globalForPrisma.quorumPrisma) await globalForPrisma.quorumPrisma.$disconnect();
}
