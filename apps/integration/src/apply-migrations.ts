import { readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';

/**
 * Apply the migrations with plain SQL.
 *
 * `prisma migrate deploy` does the same thing where its engine binaries are reachable, but
 * an integration run should not fail because a vendor CDN is unavailable. The SQL is the
 * artifact under test either way.
 */
const url = process.env.DATABASE_URL ?? 'postgresql://quorum:quorum@127.0.0.1:5433/quorum';
const client = new Client({ connectionString: url });
await client.connect();

const root = new URL('../../../packages/db/prisma/migrations/', import.meta.url).pathname;
const applied: string[] = [];

for (const dir of readdirSync(root)
  .filter((n) => !n.endsWith('.toml'))
  .sort()) {
  const sql = readFileSync(`${root}${dir}/migration.sql`, 'utf8');
  try {
    await client.query(sql);
    applied.push(dir);
  } catch (error) {
    const message = (error as { message: string }).message;
    // Re-running the script must be harmless; anything else is a genuine failure.
    if (/already exists/.test(message)) continue;
    throw error;
  }
}

console.log(
  applied.length > 0 ? `    applied ${applied.join(', ')}` : '    schema already current',
);
await client.end();
