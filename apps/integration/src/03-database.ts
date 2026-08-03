import { readFileSync, readdirSync } from 'node:fs';
import { Client } from 'pg';

/**
 * Integration probe 3: apply the hand-written migrations to a real PostgreSQL.
 *
 * The migration SQL was written by hand because `prisma migrate` could not reach its
 * engine downloads. Until now it had only been cross-checked against the schema by a
 * script — this is the first time a database has actually parsed it.
 */
const url = process.env.DATABASE_URL ?? 'postgresql://quorum@127.0.0.1:5433/quorum';
const client = new Client({ connectionString: url });
await client.connect();

const { rows: version } = await client.query<{ version: string }>('SELECT version()');
console.log(version[0]!.version.split(',')[0]);

const root = new URL('../../../packages/db/prisma/migrations/', import.meta.url).pathname;
const dirs = readdirSync(root)
  .filter((name) => !name.endsWith('.toml'))
  .sort();

for (const dir of dirs) {
  const sql = readFileSync(`${root}${dir}/migration.sql`, 'utf8');
  const started = Date.now();
  await client.query(sql);
  console.log(
    `  applied ${dir} (${String(sql.split('\n').length)} lines) in ${String(Date.now() - started)}ms`,
  );
}

const { rows: tables } = await client.query<{ table_name: string }>(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
);
console.log(`\ntables (${String(tables.length)}): ${tables.map((t) => t.table_name).join(', ')}`);

const { rows: enums } = await client.query<{ typname: string }>(
  `SELECT typname FROM pg_type WHERE typtype='e' ORDER BY typname`,
);
console.log(`enums (${String(enums.length)}): ${enums.map((e) => e.typname).join(', ')}`);

const { rows: fks } = await client.query<{ count: string }>(
  `SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public'`,
);
const { rows: idx } = await client.query<{ count: string }>(
  `SELECT count(*) FROM pg_indexes WHERE schemaname='public'`,
);
console.log(`foreign keys: ${fks[0]!.count}   indexes: ${idx[0]!.count}`);

// The cascade path an erasure request depends on.
console.log('\n=== cascade delete: one DELETE FROM "Org" must remove everything beneath ===');
await client.query(`INSERT INTO "Org"(id,name,slug,"updatedAt") VALUES ('o1','T','t',now())`);
await client.query(
  `INSERT INTO "User"(id,"orgId",email,"updatedAt") VALUES ('u1','o1','a@b.c',now())`,
);
await client.query(
  `INSERT INTO "Run"(id,"userId","orgId",goal,"updatedAt") VALUES ('r1','u1','o1','g',now())`,
);
await client.query(`INSERT INTO "Step"(id,"runId",index,objective) VALUES ('s1','r1',0,'o')`);
await client.query(
  `INSERT INTO "Claim"(id,"stepId",entity,field,value,"sourceUrl","extractedBy","promptVersion",confidence)
   VALUES ('c1','s1','E','f','15','https://x','m','v',0.9)`,
);
await client.query(
  `INSERT INTO "Event"(id,"runId",seq,type,payload) VALUES ('e1','r1',1,'run.created','{}')`,
);
await client.query(`DELETE FROM "Org" WHERE id='o1'`);
for (const table of ['User', 'Run', 'Step', 'Claim', 'Event']) {
  const { rows } = await client.query<{ count: string }>(`SELECT count(*) FROM "${table}"`);
  console.log(`  ${table.padEnd(6)} remaining: ${rows[0]!.count}`);
}

await client.end();
console.log('\nDATABASE OK');
