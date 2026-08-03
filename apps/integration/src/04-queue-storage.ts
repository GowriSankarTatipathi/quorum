import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { FilesystemStorage, artifactKeys } from '@quorum/storage';
import { createEvent, runChannel, SequenceCounter } from '@quorum/events';

const connection = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
console.log('redis PING ->', await connection.ping());

// ── BullMQ: does a job actually round-trip? ──────────────────────────────────
const queue = new Queue('quorum.integration', { connection });
const done = new Promise<string>((resolve) => {
  const worker = new Worker<{ runId: string }>(
    'quorum.integration',
    (job) => {
      void worker.close();
      resolve(job.data.runId);
      return Promise.resolve();
    },
    { connection: new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null }) },
  );
});
const t0 = Date.now();
await queue.add('run.plan', { runId: 'run_integration' }, { jobId: 'plan-run_integration' });
console.log(`bullmq round-trip -> ${await done} in ${String(Date.now() - t0)}ms`);

// Idempotent enqueue: the same jobId must not create a second job.
await queue.add('run.plan', { runId: 'run_integration' }, { jobId: 'plan-run_integration' });
console.log(`duplicate jobId suppressed -> waiting=${String(await queue.getWaitingCount())}`);

// ── Pub/sub: the transport behind the live event stream ──────────────────────
const subscriber = new Redis('redis://127.0.0.1:6379');
const counter = new SequenceCounter();
const received = new Promise<string>((resolve) => {
  subscriber.on('message', (_channel, message) => {
    resolve((JSON.parse(message) as { type: string }).type);
  });
});
await subscriber.subscribe(runChannel('run_integration'));
const event = createEvent(
  'claim.created',
  {
    claimId: 'c1',
    entity: 'Brex',
    field: 'price',
    value: 15,
    unit: 'USD',
    confidence: 0.96,
    sourceUrl: 'https://x',
  },
  { runId: 'run_integration' },
  counter.next('run_integration'),
);
await connection.publish(runChannel('run_integration'), JSON.stringify(event));
console.log(`pub/sub delivered -> ${await received}`);

// ── The approval barrier: BLPOP is what makes a blocked run cost nothing ─────
const barrier = new Redis('redis://127.0.0.1:6379', { maxRetriesPerRequest: null });
const key = 'run:run_integration:approval:ap_1';
const blockedAt = Date.now();
const waiting = barrier.blpop(key, 5);
setTimeout(() => {
  void connection.lpush(key, JSON.stringify({ decision: 'APPROVED', userId: 'u1' }));
}, 250);
const decision = await waiting;
console.log(
  `BLPOP woke after ${String(Date.now() - blockedAt)}ms -> ${(JSON.parse(decision![1]) as { decision: string }).decision}`,
);

// ── Filesystem storage ──────────────────────────────────────────────────────
const storage = new FilesystemStorage({
  root: '/tmp/quorum-artifacts',
  publicBaseUrl: 'http://localhost:3001/v1/artifacts',
  signingSecret: 'integration-signing-secret',
});
const shotKey = artifactKeys.screenshot('run_integration', 'stp_1', 1);
const put = await storage.put(shotKey, Buffer.from('fake-jpeg-bytes'), 'image/jpeg');
console.log(`\nstorage put -> ${put.key} (${String(put.bytes)} bytes)`);
console.log(`storage get -> "${(await storage.get(shotKey)).toString()}"`);

const url = await storage.signedUrl(shotKey, 900, 'shot.jpg');
const params = new URL(url).searchParams;
console.log(`signed url  -> ${url.slice(0, 72)}…`);
console.log(
  `signature verifies -> ${String(storage.verify(params.get('key')!, Number(params.get('expires')), params.get('signature')!))}`,
);
console.log(
  `tampered key rejected -> ${String(!storage.verify('other/key', Number(params.get('expires')), params.get('signature')!))}`,
);
try {
  await storage.put('../../etc/escape', Buffer.from('x'), 'text/plain');
  console.log('path traversal NOT blocked ✗');
} catch {
  console.log('path traversal blocked -> yes');
}
console.log(
  `deletePrefix -> removed ${String(await storage.deletePrefix(artifactKeys.runPrefix('run_integration')))} files`,
);

await Promise.all([queue.close(), subscriber.quit(), barrier.quit(), connection.quit()]);
console.log('\nQUEUE + STORAGE OK');
