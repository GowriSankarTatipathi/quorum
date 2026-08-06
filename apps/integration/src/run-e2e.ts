import { randomUUID } from 'node:crypto';
import assert from 'node:assert';
import { PlaywrightDriver, executeAction } from '@quorum/browser';
import {
  LlmRouter,
  MemoryCacheStore,
  PROMPT_REGISTRY,
  PlanSchema,
  BrowserActionOutputSchema,
  ReasoningOutputSchema,
  VerdictOutputSchema,
  CritiqueOutputSchema,
  createProviders,
  describeLlmConfig,
  loadLlmConfig,
  resolveCandidateModels,
  type LlmCallTelemetry,
  type LlmTelemetrySink,
} from '@quorum/ai';
import { assertGrounded, newEventId, trustLadder, type ElementDescriptor } from '@quorum/core';
import { buildExportBundle, buildWorkbook } from '@quorum/export';
import { FilesystemStorage, artifactKeys } from '@quorum/storage';
import type { ClaimRecord, CritiqueRecord, VerdictRecord } from '@quorum/db';
import { Client } from 'pg';
import { Redis } from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { runChannel } from '@quorum/events';
import { startFixtureServer } from './serve-fixture.js';
import { RECORDED_COMPLETIONS } from './recordings.js';

const GOAL = 'Get the pricing tiers for Brex — plan name and monthly price per user.';
const RUN_ID = `run_${randomUUID().slice(0, 8)}`;
const metrics: Record<string, number> = {};
const time = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const started = Date.now();
  const value = await fn();
  metrics[label] = Date.now() - started;
  return value;
};

const step = (n: number, title: string) => console.log(`\n\x1b[1m[${n}] ${title}\x1b[0m`);

// ── Configuration ───────────────────────────────────────────────────────────
const config = loadLlmConfig();
console.log(`\n\x1b[1mQUORUM end-to-end integration\x1b[0m`);
console.log(`run:  ${RUN_ID}`);
console.log(`llm:  ${describeLlmConfig(config)}`);
console.log(`      ${config.reason}`);

const calls: LlmCallTelemetry[] = [];
const streamed: string[] = [];
const telemetry: LlmTelemetrySink = {
  recordCall: (call) => {
    calls.push(call);
  },
  recordSchemaViolation: (v) =>
    console.log(`      ! schema violation from ${v.model}: ${v.issues[0] ?? ''}`),
  recordProviderFailure: (f) => console.log(`      ! ${f.model} failed: ${f.errorClass}`),
  recordFallback: (_a, from, to, why) => console.log(`      ! fallback ${from} -> ${to} (${why})`),
  recordCacheHit: () => undefined,
};

const providers = createProviders(config, { recordings: RECORDED_COMPLETIONS });
const candidates = resolveCandidateModels(config.modelOverrides, providers, (model, reason) =>
  console.log(`      ! model unavailable: ${model} (${reason})`),
);

const router = new LlmRouter({
  providers,
  telemetry,
  cache: new MemoryCacheStore(),
  timeoutMs: config.timeoutMs,
  retriesPerModel: config.retriesPerModel,
  candidates,
});

import { createRouter as createWorkerRouter } from '../../worker/src/services/llm.js';
const workerRouter = createWorkerRouter(telemetry);
assert.deepStrictEqual(
  workerRouter.candidates,
  router.candidates,
  'Integration harness and worker must resolve identical LLM candidates',
);

// ── Infrastructure ──────────────────────────────────────────────────────────
step(1, 'Infrastructure');
const db = new Client({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://quorum@127.0.0.1:5433/quorum',
});
await db.connect();
const { rows: pg } = await db.query<{ v: string }>('SELECT version() AS v');
console.log(`      postgres: ${pg[0]!.v.split(' ').slice(0, 2).join(' ')}`);

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});
console.log(`      redis:    ${await redis.ping()}`);

const storage = new FilesystemStorage({
  root: process.env.ARTIFACT_ROOT ?? '/tmp/quorum-artifacts',
  publicBaseUrl: 'http://localhost:3001/v1/artifacts',
  signingSecret: process.env.ARTIFACT_SIGNING_SECRET ?? 'integration-signing-secret',
});
console.log(`      storage:  ${storage.kind}`);

const fixture = await startFixtureServer();
console.log(`      site:     ${fixture.url}`);

// Events stream over real pub/sub, exactly as the gateway consumes them.
const subscriber = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
const streamedEvents: string[] = [];
await subscriber.subscribe(runChannel(RUN_ID));
subscriber.on('message', (_c, message) => {
  streamedEvents.push((JSON.parse(message) as { type: string }).type);
});
let seq = 0;
const emit = async (type: string, payload: unknown): Promise<void> => {
  seq += 1;
  const event = {
    id: newEventId(),
    runId: RUN_ID,
    seq,
    type,
    payload,
    ts: new Date().toISOString(),
  };
  await db.query(`INSERT INTO "Event"(id,"runId",seq,type,payload) VALUES ($1,$2,$3,$4,$5)`, [
    event.id,
    RUN_ID,
    seq,
    type,
    JSON.stringify(payload),
  ]);
  await redis.publish(runChannel(RUN_ID), JSON.stringify(event));
};

// ── Seed a workspace and the run ────────────────────────────────────────────
const ORG = `org_${RUN_ID}`;
const USER = `usr_${RUN_ID}`;
await db.query(`INSERT INTO "Org"(id,name,slug,"updatedAt") VALUES ($1,'Integration',$2,now())`, [
  ORG,
  ORG,
]);
await db.query(`INSERT INTO "User"(id,"orgId",email,"updatedAt") VALUES ($1,$2,$3,now())`, [
  USER,
  ORG,
  `${USER}@test.local`,
]);
await db.query(
  `INSERT INTO "Run"(id,"userId","orgId",goal,mode,status,"budgetUsd","updatedAt","startedAt")
   VALUES ($1,$2,$3,$4,'BALANCED','PLANNING',0.50,now(),now())`,
  [RUN_ID, USER, ORG, GOAL],
);
await emit('run.created', { goal: GOAL });

// ── BullMQ dispatch ─────────────────────────────────────────────────────────
step(2, 'Queue dispatch (BullMQ)');
const queue = new Queue('quorum.e2e', { connection: redis });
const dispatched = new Promise<void>((resolve) => {
  const worker = new Worker(
    'quorum.e2e',
    () => {
      void worker.close();
      resolve();
      return Promise.resolve();
    },
    {
      connection: new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
        maxRetriesPerRequest: null,
      }),
    },
  );
});
await queue.add('run.plan', { runId: RUN_ID }, { jobId: `plan-${RUN_ID}` });
await time('queue_dispatch_ms', () => dispatched);
console.log(`      job delivered in ${String(metrics.queue_dispatch_ms)}ms`);

// ── Planner ─────────────────────────────────────────────────────────────────
step(3, 'Planner');
const plannerPrompt = PROMPT_REGISTRY.planner.build({
  goal: GOAL,
  mode: 'BALANCED',
  budgetUsd: 0.5,
  maxSteps: 20,
  allowedDomains: ['127.0.0.1'],
});
const plan = await time('planner_ms', () =>
  router.call(
    {
      agent: 'planner',
      promptVersion: PROMPT_REGISTRY.planner.version,
      system: plannerPrompt.system,
      user: plannerPrompt.user,
    },
    PlanSchema,
  ),
);
console.log(
  `      ${String(plan.data.steps.length)} step(s), confidence ${String(plan.data.confidence)}, ${String(metrics.planner_ms)}ms`,
);
for (const s of plan.data.steps)
  console.log(`        ${String(s.index + 1)}. ${s.objective} [${s.riskLevel}]`);
const STEP_ID = `stp_${RUN_ID}`;
await db.query(
  `INSERT INTO "Step"(id,"runId",index,objective,"targetUrl","agentPath","riskLevel",status)
   VALUES ($1,$2,0,$3,$4,$5,$6,'RUNNING')`,
  [
    STEP_ID,
    RUN_ID,
    plan.data.steps[0]!.objective,
    fixture.url,
    plan.data.steps[0]!.agentPath,
    plan.data.steps[0]!.riskLevel,
  ],
);
await emit('plan.completed', { stepCount: plan.data.steps.length });

// ── Browser ─────────────────────────────────────────────────────────────────
step(4, 'Browser');
const driver = new PlaywrightDriver({ headless: true });
const session = await time('browser_launch_ms', () =>
  driver.createSession({
    runId: RUN_ID,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'UTC',
    allowedHosts: ['127.0.0.1'],
    respectRobotsTxt: false,
  }),
);
await driver.navigate(session, fixture.url);
let snapshot = await time('snapshot_ms', () => driver.snapshot(session));
console.log(
  `      launch ${String(metrics.browser_launch_ms)}ms, snapshot ${String(metrics.snapshot_ms)}ms — ${String(snapshot.nodeCount)} nodes / ${String(snapshot.tree.length)} chars`,
);
await emit('browser.navigate', { url: snapshot.url });

const recent: string[] = [];
for (let attempt = 1; attempt <= 4; attempt += 1) {
  const prompt = PROMPT_REGISTRY.browser.build({
    stepObjective: plan.data.steps[0]!.objective,
    page: snapshot.tree,
    url: snapshot.url,
    recentActions: recent,
    attempt,
    maxAttempts: 4,
  });
  const decision = await router.call(
    {
      agent: 'browser',
      promptVersion: PROMPT_REGISTRY.browser.version,
      system: prompt.system,
      user: prompt.user,
    },
    BrowserActionOutputSchema,
  );
  const chosen = decision.data.action;
  const refLabel =
    'ref' in chosen && typeof chosen.ref === 'number' ? ` [${String(chosen.ref)}]` : '';
  console.log(
    `      turn ${String(attempt)}: ${chosen.type}${refLabel} — ${decision.data.reasoning.slice(0, 88)}`,
  );

  if (chosen.type === 'extract_ready' || chosen.type === 'give_up') break;
  // `wait_for` also carries a ref, but a nullable one, so the narrowing has to be on the
  // value rather than merely on the property being present.
  if (chosen.type !== 'click' || typeof chosen.ref !== 'number') break;

  const ref: number = chosen.ref;
  const target: ElementDescriptor | undefined = snapshot.elements.get(ref);
  if (!target) {
    console.log(`      ! stale ref ${String(ref)} — re-reading the page`);
    snapshot = await driver.snapshot(session);
    continue;
  }
  const action = { type: 'click' as const, ref, target };
  const verdict = trustLadder(action, 'BALANCED', { allowedHosts: ['127.0.0.1'] });
  console.log(
    `        gate: L${String(verdict.level)} ${verdict.requiresApproval ? 'GATED' : 'free'}`,
  );

  let executed;
  try {
    executed = await executeAction(driver, session, action, snapshot, {
      mode: 'BALANCED',
      allowedHosts: ['127.0.0.1'],
      ...(verdict.requiresApproval ? { approvalToken: 'integration-approval' } : {}),
      onEvent: (e) => {
        if (e.type === 'action.ok') console.log(`        changed=${String(e.changed)}`);
      },
    });
  } catch (actionError) {
    const msg = actionError instanceof Error ? actionError.message : String(actionError);
    console.log(`        ! action failed: ${msg} — re-reading the page`);
    snapshot = await driver.snapshot(session);
    recent.push(`click [${String(ref)}] (failed: ${msg})`);
    continue;
  }
  snapshot = executed.snapshotAfter;
  recent.push(`click [${String(ref)}]`);
  await emit('browser.action.ok', { action: { type: 'click' } });
}

const capture = await driver.capture(session);
const shotKey = artifactKeys.screenshot(RUN_ID, STEP_ID, 1);
await storage.put(shotKey, capture.screenshot, 'image/jpeg');
console.log(`      screenshot stored: ${shotKey} (${String(capture.screenshot.byteLength)} bytes)`);
await emit('browser.screenshot', { key: shotKey });

// ── Extraction + grounding ──────────────────────────────────────────────────
step(5, 'Extraction and grounding');
const reasoningPrompt = PROMPT_REGISTRY.reasoning.build({
  stepObjective: plan.data.steps[0]!.objective,
  outputSchema: plan.data.steps[0]!.outputSchema,
  url: snapshot.url,
  pageContent: snapshot.tree,
  knownFields: [],
});
const extraction = await time('reasoning_ms', () =>
  router.call(
    {
      agent: 'reasoning',
      promptVersion: PROMPT_REGISTRY.reasoning.version,
      system: reasoningPrompt.system,
      user: reasoningPrompt.user,
    },
    ReasoningOutputSchema,
  ),
);
const captured = `${capture.a11y}\n${capture.html}`;
const stored: ClaimRecord[] = [];
let quarantined = 0;

for (const claim of extraction.data.claims) {
  const grounding = assertGrounded({
    value: claim.value,
    sourceText: claim.sourceText,
    captured,
    requireValueInSource: typeof claim.value === 'number',
  });
  if (!grounding.grounded) {
    quarantined += 1;
    console.log(`      QUARANTINED ${claim.field} = ${String(claim.value)} — ${grounding.reason}`);
    continue;
  }
  const id = `clm_${randomUUID().slice(0, 8)}`;
  await db.query(
    `INSERT INTO "Claim"(id,"stepId",entity,field,value,unit,"sourceUrl","sourceText","screenshotKey","extractedBy","promptVersion",confidence,status,"nullReason")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'UNVERIFIED',$13)`,
    [
      id,
      STEP_ID,
      claim.entity,
      claim.field,
      JSON.stringify(claim.value),
      claim.unit,
      snapshot.url,
      claim.sourceText,
      shotKey,
      extraction.model,
      PROMPT_REGISTRY.reasoning.version,
      claim.confidence === null ? null : claim.confidence.toFixed(3),
      claim.nullReason,
    ],
  );
  stored.push({
    id,
    stepId: STEP_ID,
    entity: claim.entity,
    field: claim.field,
    value: claim.value,
    unit: claim.unit,
    sourceUrl: snapshot.url,
    sourceSelector: null,
    sourceText: claim.sourceText,
    screenshotKey: shotKey,
    domSnapshotKey: null,
    extractedAt: new Date(),
    extractedBy: extraction.model,
    promptVersion: PROMPT_REGISTRY.reasoning.version,
    confidence: claim.confidence,
    status: 'UNVERIFIED',
    ambiguity: claim.ambiguity,
    nullReason: claim.nullReason,
    supersedesId: null,
    correctedBy: null,
  });
  console.log(
    `      kept  ${claim.field} = ${String(claim.value)} "${claim.sourceText ?? ''}" (${grounding.reason})`,
  );
  await emit('claim.created', { claimId: id, field: claim.field, value: claim.value });
}
console.log(`      ${String(stored.length)} stored, ${String(quarantined)} quarantined`);

// ── Verification ────────────────────────────────────────────────────────────
step(6, 'Verification');
const verdicts = new Map<string, VerdictRecord[]>();
const toVerify = stored.filter((c) => c.value !== null).slice(0, 1);
for (const claim of toVerify) {
  const prompt = PROMPT_REGISTRY.verification.build({
    url: claim.sourceUrl,
    capturedAt: capture.capturedAt,
    sourceRegion: snapshot.tree,
    field: claim.field,
    claimedValue: claim.value,
    unit: claim.unit,
  });
  const verdict = await time('verification_ms', () =>
    router.call(
      {
        agent: 'verification',
        promptVersion: PROMPT_REGISTRY.verification.version,
        system: prompt.system,
        user: prompt.user,
      },
      VerdictOutputSchema,
    ),
  );
  const status = verdict.data.verdict === 'CONFIRMED' ? 'VERIFIED' : verdict.data.verdict;
  const vid = `vd_${randomUUID().slice(0, 8)}`;
  await db.query(
    `INSERT INTO "Verdict"(id,"claimId",verdict,"independentReading",rationale,confidence,model)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      vid,
      claim.id,
      status,
      JSON.stringify(verdict.data.independentReading),
      verdict.data.rationale,
      verdict.data.confidence === null ? null : verdict.data.confidence.toFixed(3),
      verdict.model,
    ],
  );
  await db.query(`UPDATE "Claim" SET status=$1 WHERE id=$2`, [status, claim.id]);
  claim.status = status;
  verdicts.set(claim.id, [
    {
      id: vid,
      claimId: claim.id,
      verdict: status,
      independentReading: verdict.data.independentReading,
      rationale: verdict.data.rationale,
      confidence: verdict.data.confidence,
      model: verdict.model,
      createdAt: new Date(),
    },
  ]);
  console.log(`      ${claim.field}: read ${String(verdict.data.independentReading)} -> ${status}`);
  await emit('claim.verified', { claimId: claim.id, verdict: status });
}

// ── Critic ──────────────────────────────────────────────────────────────────
step(7, 'Critic');
const criticPrompt = PROMPT_REGISTRY.critic.build({
  goal: GOAL,
  claims: stored.map((c) => ({
    id: c.id,
    entity: c.entity,
    field: c.field,
    value: c.value,
    unit: c.unit,
    confidence: c.confidence,
    sourceUrl: c.sourceUrl,
    status: c.status,
  })),
  expectedEntityCount: 1,
});
const critique = await time('critic_ms', () =>
  router.call(
    {
      agent: 'critic',
      promptVersion: PROMPT_REGISTRY.critic.version,
      system: criticPrompt.system,
      user: criticPrompt.user,
    },
    CritiqueOutputSchema,
  ),
);
const knownIds = new Set(stored.map((c) => c.id));
const critiques: CritiqueRecord[] = [];
for (const c of critique.data.critiques) {
  const cited = c.claimIds.filter((id) => knownIds.has(id));
  const ids =
    c.claimIds.length === 0 ? [] : cited.length > 0 ? cited : stored.slice(0, 1).map((s) => s.id);
  const cid = `crt_${randomUUID().slice(0, 8)}`;
  await db.query(
    `INSERT INTO "Critique"(id,"runId",kind,severity,message,"claimIds",remedy) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [cid, RUN_ID, c.kind, c.severity, c.message, ids, JSON.stringify(c.remedy)],
  );
  critiques.push({
    id: cid,
    runId: RUN_ID,
    kind: c.kind,
    severity: c.severity,
    message: c.message,
    claimIds: ids,
    remedy: { ...c.remedy },
    resolution: 'OPEN',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(),
  });
  console.log(`      ${c.severity} ${c.kind}: ${c.message.slice(0, 96)}`);
  await emit('critique.raised', { critiqueId: cid, kind: c.kind, severity: c.severity });
}
if (critiques.length === 0) console.log('      no findings — clean data is a valid result');

// ── Export ──────────────────────────────────────────────────────────────────
step(8, 'Workbook with provenance');
const bundle = buildExportBundle({
  claims: stored,
  verdictsByClaim: verdicts,
  critiques,
  artifactBaseUrl: 'http://localhost:3001/v1/artifacts',
});
const workbook = await time('workbook_ms', () =>
  buildWorkbook(bundle, {
    runId: RUN_ID,
    goal: GOAL,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    spentUsd: calls.reduce((sum, c) => sum + c.cost.usd, 0),
    mode: 'BALANCED',
  }),
);
const exportKey = artifactKeys.export(RUN_ID, 'xlsx', Date.now());
await storage.put(
  exportKey,
  workbook,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
);
console.log(`      ${String(workbook.byteLength)} bytes -> ${exportKey}`);
console.log(
  `      results ${String(bundle.results.length)} | provenance ${String(bundle.provenance.length)} | excluded ${String(bundle.summary.excluded)} | mean confidence ${String(bundle.summary.meanConfidence)}`,
);
for (const row of bundle.provenance) {
  console.log(
    `        ${row.field} = ${row.value}  <- "${row.sourceText}"  ${row.screenshot ? 'screenshot ✓' : 'no shot'}`,
  );
}
const signed = await storage.signedUrl(exportKey, 900, 'quorum-brex.xlsx');
console.log(`      signed download: ${signed.slice(0, 96)}…`);

// ── Results ─────────────────────────────────────────────────────────────────
await db.query(`UPDATE "Run" SET status='COMPLETED', "endedAt"=now() WHERE id=$1`, [RUN_ID]);
await emit('run.completed', { claimCount: stored.length });
await new Promise((r) => setTimeout(r, 150));

step(9, 'Verification of the whole run');
const { rows: counts } = await db.query<{
  claims: string;
  events: string;
  verdicts: string;
  critiques: string;
}>(
  `SELECT (SELECT count(*) FROM "Claim" WHERE "stepId"=$1) AS claims,
          (SELECT count(*) FROM "Event" WHERE "runId"=$2) AS events,
          (SELECT count(*) FROM "Verdict" v JOIN "Claim" c ON c.id=v."claimId" WHERE c."stepId"=$1) AS verdicts,
          (SELECT count(*) FROM "Critique" WHERE "runId"=$2) AS critiques`,
  [STEP_ID, RUN_ID],
);
console.log(
  `      persisted: ${counts[0]!.claims} claims, ${counts[0]!.verdicts} verdicts, ${counts[0]!.critiques} critiques, ${counts[0]!.events} events`,
);
console.log(
  `      streamed over pub/sub: ${String(streamedEvents.length)} events -> ${streamedEvents.join(', ')}`,
);
console.log(
  `      artifacts on disk: screenshot ${String(await storage.exists(shotKey))}, workbook ${String(await storage.exists(exportKey))}`,
);

const totalUsd = calls.reduce((sum, c) => sum + c.cost.usd, 0);
const inputTokens = calls.reduce((sum, c) => sum + c.cost.inputTokens, 0);
const outputTokens = calls.reduce((sum, c) => sum + c.cost.outputTokens, 0);

console.log(`\n\x1b[1m=== METRICS ===\x1b[0m`);
console.log(`mode              ${config.mode}`);
console.log(`llm calls         ${String(calls.length)}`);
console.log(`tokens            ${String(inputTokens)} in / ${String(outputTokens)} out`);
console.log(`cost              $${totalUsd.toFixed(6)}`);
for (const [k, v] of Object.entries(metrics)) console.log(`${k.padEnd(18)}${String(v)}ms`);
console.log(`\nper-agent latency:`);
for (const call of calls) {
  console.log(
    `  ${call.agent.padEnd(13)} ${call.model.padEnd(20)} ${String(call.latencyMs).padStart(6)}ms  ${String(call.cost.inputTokens)}/${String(call.cost.outputTokens)} tok  $${call.cost.usd.toFixed(6)}`,
  );
}

await driver.shutdown();
fixture.close();
await Promise.all([queue.close(), subscriber.quit(), redis.quit()]);
await db.end();
void streamed;
console.log(`\n\x1b[32m\x1b[1mE2E COMPLETE\x1b[0m — run ${RUN_ID}\n`);
