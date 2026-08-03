import { PlaywrightDriver, executeAction } from '@quorum/browser';
import { startFixtureServer } from './serve-fixture.js';

/** Integration probe 1: the real browser, through the real driver. */
const t0 = Date.now();
const fixture = await startFixtureServer();
console.log(`fixture at ${fixture.url}`);

const driver = new PlaywrightDriver({ headless: true });
const session = await driver.createSession({
  runId: 'integration',
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
  timezoneId: 'UTC',
  allowedHosts: ['127.0.0.1'],
  respectRobotsTxt: false,
});
console.log(`session ${session.id} launched in ${Date.now() - t0}ms`);

const nav = await driver.navigate(session, fixture.url);
console.log(`navigate -> status ${String(nav.status)} "${nav.title}" ${nav.durationMs}ms`);

const snap = await driver.snapshot(session);
console.log(
  `\n=== SNAPSHOT ${snap.nodeCount} nodes / ${snap.tree.length} chars / hash ${snap.contentHash} ===`,
);
console.log(snap.tree);
console.log('=== END ===\n');

console.log('refs and the DOM facts the Trust Ladder classifies on:');
for (const [ref, el] of snap.elements) {
  const extras = [
    el.inputType ? `inputType=${el.inputType}` : '',
    el.isSubmit ? 'isSubmit' : '',
    el.href ? `href=${el.href}` : '',
    snap.boxes.has(ref) ? 'box' : 'NO-BOX',
  ]
    .filter(Boolean)
    .join(' ');
  console.log(`  [${ref}] ${el.role} "${el.name}" ${extras}`);
}

const shot = await driver.screenshot(session);
console.log(
  `\nscreenshot ${String(shot.byteLength)} bytes jpeg=${String(shot[0] === 0xff && shot[1] === 0xd8)}`,
);

await driver.closeSession(session.id);
await driver.shutdown();
fixture.close();
console.log(`total ${String(Date.now() - t0)}ms`);
void executeAction;
