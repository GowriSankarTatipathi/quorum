import { chromium } from 'playwright-core';
import { startFixtureServer } from './serve-fixture.mjs';
import { PlaywrightDriver } from '../../packages/browser/dist/playwright/driver.js';
import { executeAction } from '../../packages/browser/dist/execute.js';

/** Integration probe 1: does the real browser path work end to end? */
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
console.log(`session ${session.id} in ${Date.now() - t0}ms`);

const nav = await driver.navigate(session, fixture.url);
console.log(`navigate -> ${nav.status} "${nav.title}" ${nav.durationMs}ms`);

const snap = await driver.snapshot(session);
console.log(
  `\n=== SNAPSHOT: ${snap.nodeCount} nodes, ${snap.tree.length} chars, hash ${snap.contentHash} ===`,
);
console.log(snap.tree);
console.log('=== END SNAPSHOT ===\n');

console.log('refs with DOM facts:');
for (const [ref, el] of snap.elements) {
  const extras = [
    el.inputType && `inputType=${el.inputType}`,
    el.isSubmit && 'isSubmit',
    el.href && `href=${el.href}`,
  ]
    .filter(Boolean)
    .join(' ');
  console.log(
    `  [${ref}] ${el.role} "${el.name}" ${extras} box=${snap.boxes.has(ref) ? 'yes' : 'NO'}`,
  );
}

const shot = await driver.screenshot(session);
console.log(`\nscreenshot: ${shot.byteLength} bytes, jpeg=${shot[0] === 0xff && shot[1] === 0xd8}`);

await driver.closeSession(session.id);
await driver.shutdown();
fixture.close();
console.log(`\ntotal ${Date.now() - t0}ms`);
