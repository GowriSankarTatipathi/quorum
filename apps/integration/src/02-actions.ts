import { ApprovalRequiredError, PlaywrightDriver, executeAction } from '@quorum/browser';
import { TrustLevel, classify, trustLadder, type BrowserAction } from '@quorum/core';
import { startFixtureServer } from './serve-fixture.js';

const fixture = await startFixtureServer();
const driver = new PlaywrightDriver({ headless: true });
const session = await driver.createSession({
  runId: 'integration',
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
  timezoneId: 'UTC',
  allowedHosts: ['127.0.0.1'],
  respectRobotsTxt: false,
});
await driver.navigate(session, fixture.url);
let snap = await driver.snapshot(session);

const find = (predicate: (name: string, role: string) => boolean) => {
  for (const [ref, el] of snap.elements) if (predicate(el.name, el.role)) return { ref, el };
  throw new Error('element not found');
};

console.log('=== Trust Ladder against REAL elements ===');
for (const [ref, el] of snap.elements) {
  if (!['button', 'link', 'radio', 'textbox'].includes(el.role)) continue;
  const action: BrowserAction = { type: 'click', ref, target: el };
  console.log(
    `  L${String(classify(action, { allowedHosts: ['127.0.0.1'] }))}  ${el.role.padEnd(8)} "${el.name}"`,
  );
}

const monthly = find((name) => name === 'Monthly');
const demo = find((name) => name.includes('Request a demo'));

console.log('\n=== gating ===');
console.log(
  `  toggle  -> ${trustLadder({ type: 'click', ref: monthly.ref, target: monthly.el }, 'BALANCED').requiresApproval ? 'GATED' : 'free'}`,
);
console.log(
  `  submit  -> ${trustLadder({ type: 'click', ref: demo.ref, target: demo.el }, 'BALANCED').requiresApproval ? 'GATED' : 'free'}`,
);

console.log('\n=== executeAction: click Monthly (real click) ===');
const events: string[] = [];
const before = snap.contentHash;
const result = await executeAction(
  driver,
  session,
  { type: 'click', ref: monthly.ref, target: monthly.el },
  snap,
  {
    mode: 'BALANCED',
    allowedHosts: ['127.0.0.1'],
    onEvent: (e) => {
      events.push(e.type);
    },
  },
);
snap = result.snapshotAfter;
console.log(`  events: ${events.join(' -> ')}`);
console.log(`  changed: ${String(result.changed)} (${before} -> ${snap.contentHash})`);
console.log(`  price now: ${snap.tree.includes('$15') ? '$15 MONTHLY ✓' : 'NOT UPDATED ✗'}`);

console.log('\n=== no-op detection: click Monthly again (already selected) ===');
try {
  await executeAction(
    driver,
    session,
    { type: 'click', ref: monthly.ref, target: monthly.el },
    snap,
    {
      mode: 'BALANCED',
      allowedHosts: ['127.0.0.1'],
    },
  );
  console.log('  NOT DETECTED ✗');
} catch (error) {
  console.log(`  detected: ${(error as { errorClass?: string }).errorClass} ✓`);
}

console.log('\n=== gate blocks an ungapproved submit ===');
try {
  await executeAction(driver, session, { type: 'click', ref: demo.ref, target: demo.el }, snap, {
    mode: 'BALANCED',
    allowedHosts: ['127.0.0.1'],
  });
  console.log('  NOT BLOCKED ✗');
} catch (error) {
  console.log(
    error instanceof ApprovalRequiredError
      ? `  blocked: L${String(error.verdict.level)} ✓`
      : '  blocked: wrong error type ✗',
  );
}

console.log('\n=== domain allowlist enforced by the driver ===');
try {
  await driver.navigate(session, 'https://example.com/');
  console.log('  NOT BLOCKED ✗');
} catch (error) {
  console.log(`  blocked: ${(error as Error).name} ✓`);
}

void TrustLevel;
await driver.shutdown();
fixture.close();
