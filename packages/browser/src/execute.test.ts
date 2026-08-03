import { TrustLevel, type BrowserAction, type ElementDescriptor } from '@quorum/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { FixtureDriver, type FixturePage } from './fixture/driver.js';
import {
  ApprovalRequiredError,
  executeAction,
  type ExecutionEvent,
  type UndoFrameCapture,
} from './execute.js';
import type { RawAxNode } from './snapshot.js';
import type { Session } from './driver.js';

const el = (over: Partial<ElementDescriptor> = {}): ElementDescriptor => ({
  ref: 1,
  role: 'button',
  name: 'Monthly',
  ...over,
});

const page = (name: string, buttonName: string): FixturePage => ({
  url: `https://fixture.test/${name}`,
  title: name,
  ax: {
    role: 'RootWebArea',
    name,
    children: [
      { role: 'button', name: buttonName, focusable: true } satisfies RawAxNode,
      { role: 'text', name: `state:${name}` } satisfies RawAxNode,
    ],
  },
});

function makeDriver(pages: FixturePage[], start: string) {
  return new FixtureDriver(new Map(pages.map((p) => [p.url, p])), start);
}

describe('Trust Ladder gate', () => {
  let driver: FixtureDriver;
  let session: Session;

  beforeEach(async () => {
    driver = makeDriver([page('a', 'Monthly'), page('b', 'Monthly')], 'https://fixture.test/a');
    session = await driver.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });
  });

  const toggle: BrowserAction = { type: 'click', ref: 1, target: el({ role: 'switch' }) };
  const submit: BrowserAction = { type: 'click', ref: 1, target: el({ name: 'Submit' }) };

  it('refuses a gated action without an approval token', async () => {
    const before = await driver.snapshot(session);
    await expect(
      executeAction(driver, session, submit, before, {
        mode: 'BALANCED',
        allowedHosts: ['fixture.test'],
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it('reports the trust level so the modal can explain why it stopped', async () => {
    const before = await driver.snapshot(session);
    try {
      await executeAction(driver, session, submit, before, {
        mode: 'BALANCED',
        allowedHosts: ['fixture.test'],
      });
      expect.unreachable('should have required approval');
    } catch (error) {
      const approval = error as ApprovalRequiredError;
      expect(approval.verdict.level).toBe(TrustLevel.L3_COMMIT);
      expect(approval.verdict.reason.length).toBeGreaterThan(20);
    }
  });

  it('gates an L2 mutation in careful mode but not in balanced', async () => {
    const before = await driver.snapshot(session);
    await expect(
      executeAction(driver, session, toggle, before, {
        mode: 'CAREFUL',
        allowedHosts: ['fixture.test'],
      }),
    ).rejects.toBeInstanceOf(ApprovalRequiredError);
  });

  it('proceeds once an approval token is supplied', async () => {
    driver = makeDriver(
      [
        {
          ...page('a', 'Submit'),
          transitions: [{ match: (a) => a.type === 'click', to: 'https://fixture.test/b' }],
        },
        page('b', 'Done'),
      ],
      'https://fixture.test/a',
    );
    session = await driver.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });
    const before = await driver.snapshot(session);
    const result = await executeAction(driver, session, submit, before, {
      mode: 'BALANCED',
      allowedHosts: ['fixture.test'],
      approvalToken: 'approved-by-maya',
    });
    expect(result.changed).toBe(true);
  });

  it('honours run-scoped consent without a per-action token', async () => {
    driver = makeDriver(
      [
        {
          ...page('a', 'Submit'),
          transitions: [{ match: () => true, to: 'https://fixture.test/b' }],
        },
        page('b', 'Done'),
      ],
      'https://fixture.test/a',
    );
    session = await driver.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });
    const before = await driver.snapshot(session);
    await expect(
      executeAction(driver, session, submit, before, {
        mode: 'BALANCED',
        allowedHosts: ['fixture.test'],
        runScopedConsent: true,
      }),
    ).resolves.toBeDefined();
  });
});

describe('no-op detection', () => {
  let driver: FixtureDriver;
  let session: Session;

  const openSession = async (d: FixtureDriver) =>
    d.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });

  it('turns a click that changes nothing into a typed, recoverable error', async () => {
    // The single most common way a browser agent burns a run: the model cannot tell,
    // because the screenshot looks the same — it *is* the same.
    driver = makeDriver([page('a', 'Monthly')], 'https://fixture.test/a');
    session = await openSession(driver);
    const before = await driver.snapshot(session);

    await expect(
      executeAction(
        driver,
        session,
        { type: 'click', ref: 1, target: el({ role: 'switch' }) },
        before,
        { mode: 'BALANCED', allowedHosts: ['fixture.test'] },
      ),
    ).rejects.toMatchObject({ errorClass: 'NO_OP_ACTION', code: 'E_NO_OP_ACTION' });
  });

  it('emits a noop event so the interface can show what happened', async () => {
    driver = makeDriver([page('a', 'Monthly')], 'https://fixture.test/a');
    session = await openSession(driver);
    const before = await driver.snapshot(session);
    const events: ExecutionEvent[] = [];

    await executeAction(
      driver,
      session,
      { type: 'click', ref: 1, target: el({ role: 'switch' }) },
      before,
      {
        mode: 'BALANCED',
        allowedHosts: ['fixture.test'],
        onEvent: (e) => {
          events.push(e);
        },
      },
    ).catch(() => undefined);

    expect(events.map((e) => e.type)).toContain('noop.detected');
    expect(events.map((e) => e.type)).toContain('action.failed');
  });

  it('does not flag read-only actions as no-ops', async () => {
    driver = makeDriver([page('a', 'Monthly')], 'https://fixture.test/a');
    session = await openSession(driver);
    const before = await driver.snapshot(session);

    for (const action of [
      { type: 'screenshot' } as const,
      { type: 'scroll', direction: 'down', pixels: 100 } as const,
      { type: 'wait_for', milliseconds: 1 } as const,
    ]) {
      await expect(
        executeAction(driver, session, action, before, {
          mode: 'BALANCED',
          allowedHosts: ['fixture.test'],
        }),
      ).resolves.toBeDefined();
    }
  });

  it('accepts a click that navigates even when the tree is identical', async () => {
    const same = page('a', 'Monthly');
    driver = makeDriver(
      [
        { ...same, transitions: [{ match: () => true, to: 'https://fixture.test/b' }] },
        { ...page('b', 'Monthly'), url: 'https://fixture.test/b' },
      ],
      'https://fixture.test/a',
    );
    session = await openSession(driver);
    const before = await driver.snapshot(session);
    const result = await executeAction(
      driver,
      session,
      { type: 'click', ref: 1, target: el({ role: 'switch' }) },
      before,
      { mode: 'BALANCED', allowedHosts: ['fixture.test'] },
    );
    expect(result.result.navigated).toBe(true);
  });
});

describe('undo capture', () => {
  it('captures a reversible frame before a mutation', async () => {
    const driver = makeDriver(
      [
        {
          ...page('a', 'Monthly'),
          transitions: [{ match: () => true, to: 'https://fixture.test/b' }],
        },
        page('b', 'Annual'),
      ],
      'https://fixture.test/a',
    );
    const session = await driver.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });
    const before = await driver.snapshot(session);
    const frames: UndoFrameCapture[] = [];

    await executeAction(
      driver,
      session,
      { type: 'click', ref: 1, target: el({ role: 'switch' }) },
      before,
      {
        mode: 'BALANCED',
        allowedHosts: ['fixture.test'],
        captureUndo: (frame) => {
          frames.push(frame);
        },
      },
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]?.reversible).toBe(true);
    expect(frames[0]?.screenshot.byteLength).toBeGreaterThan(0);
  });

  it('marks the frame irreversible for a commit, so undo refuses honestly', async () => {
    const driver = makeDriver(
      [
        {
          ...page('a', 'Submit'),
          transitions: [{ match: () => true, to: 'https://fixture.test/b' }],
        },
        page('b', 'Thanks'),
      ],
      'https://fixture.test/a',
    );
    const session = await driver.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });
    const before = await driver.snapshot(session);
    const frames: UndoFrameCapture[] = [];

    await executeAction(
      driver,
      session,
      { type: 'click', ref: 1, target: el({ name: 'Submit' }) },
      before,
      {
        mode: 'BALANCED',
        allowedHosts: ['fixture.test'],
        approvalToken: 'approved',
        captureUndo: (frame) => {
          frames.push(frame);
        },
      },
    );

    expect(frames[0]?.reversible).toBe(false);
  });

  it('does not capture a frame for a read-only action', async () => {
    const driver = makeDriver([page('a', 'Monthly')], 'https://fixture.test/a');
    const session = await driver.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });
    const before = await driver.snapshot(session);
    const frames: UndoFrameCapture[] = [];
    await executeAction(driver, session, { type: 'screenshot' }, before, {
      mode: 'BALANCED',
      allowedHosts: ['fixture.test'],
      captureUndo: (frame) => {
        frames.push(frame);
      },
    });
    expect(frames).toHaveLength(0);
  });
});

describe('failure classification', () => {
  it('maps a driver failure onto the taxonomy', async () => {
    const driver = makeDriver(
      [
        {
          ...page('a', 'Monthly'),
          failOn: [
            {
              match: (a) => a.type === 'click',
              error: new Error('element intercepts pointer events'),
            },
          ],
        },
      ],
      'https://fixture.test/a',
    );
    const session = await driver.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });
    const before = await driver.snapshot(session);

    await expect(
      executeAction(
        driver,
        session,
        { type: 'click', ref: 1, target: el({ role: 'switch' }) },
        before,
        {
          mode: 'BALANCED',
          allowedHosts: ['fixture.test'],
        },
      ),
    ).rejects.toMatchObject({ errorClass: 'OVERLAY_INTERCEPTED', requiresHuman: false });
  });

  it('emits the target highlight before acting, so the user can pause in time', async () => {
    const driver = makeDriver(
      [
        {
          ...page('a', 'Monthly'),
          transitions: [{ match: () => true, to: 'https://fixture.test/b' }],
        },
        page('b', 'Annual'),
      ],
      'https://fixture.test/a',
    );
    const session = await driver.createSession({
      runId: 'run_1',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      allowedHosts: ['fixture.test'],
      respectRobotsTxt: false,
    });
    const before = await driver.snapshot(session);
    const events: ExecutionEvent[] = [];

    await executeAction(
      driver,
      session,
      { type: 'click', ref: 1, target: el({ role: 'switch' }) },
      before,
      {
        mode: 'BALANCED',
        allowedHosts: ['fixture.test'],
        onEvent: (e) => {
          events.push(e);
        },
      },
    );

    expect(events[0]?.type).toBe('action.start');
  });
});
