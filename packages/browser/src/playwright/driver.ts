import { assertNever, type BrowserAction } from '@quorum/core';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import {
  DEFAULT_SESSION_OPTIONS,
  type ActionResult,
  type BoundingBox,
  type BrowserDriver,
  type NavResult,
  type PageCapture,
  type PageSnapshot,
  type Session,
  type SessionOptions,
  type ShotOptions,
} from '../driver.js';
import { ALLOW_ALL, isUrlAllowed, parseRobots, type RobotsPolicy } from '../robots.js';
import {
  DEFAULT_COMPRESS_OPTIONS,
  compressAxTree,
  contentHash,
  type RawAxNode,
} from '../snapshot.js';
import { getAccessibilityTree } from './cdp-ax.js';

/** Realistic enough that ordinary marketing pages do not treat us as a scraper. */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface LiveSession {
  session: Session;
  context: BrowserContext;
  page: Page;
  /** ref -> accessible name, resolved through Playwright's own locators on use. */
  refs: Map<number, { role: string; name: string }>;
  robots: RobotsPolicy;
  allowedHosts: readonly string[];
  respectRobots: boolean;
  humanControl: boolean;
  lastSnapshotHash: string | null;
}

export class StaleRefError extends Error {
  constructor(ref: number) {
    super(`Ref ${String(ref)} is no longer on the page`);
    this.name = 'StaleRefError';
  }
}

export class DomainNotAllowedError extends Error {
  constructor(url: string) {
    super(`Navigation to ${url} is outside the hosts this run may visit`);
    this.name = 'DomainNotAllowedError';
  }
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt asks automated visitors not to read ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

/**
 * The local Playwright driver.
 *
 * Depends on `playwright-core` rather than `playwright`: the latter downloads browsers on
 * install, which is wrong for a worker image that already ships them and wrong for CI,
 * which never launches one.
 */
export class PlaywrightDriver implements BrowserDriver {
  readonly kind = 'playwright' as const;
  private browser: Browser | null = null;
  private readonly sessions = new Map<string, LiveSession>();

  constructor(private readonly options: { headless?: boolean } = {}) {}

  private async ensureBrowser(): Promise<Browser> {
    this.browser ??= await chromium.launch({
      headless: this.options.headless ?? true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });
    return this.browser;
  }

  private live(sessionId: string): LiveSession {
    const live = this.sessions.get(sessionId);
    if (!live) throw new Error(`Browser session ${sessionId} is not open`);
    return live;
  }

  async createSession(opts: SessionOptions): Promise<Session> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      viewport: opts.viewport,
      userAgent: opts.userAgent ?? USER_AGENT,
      locale: opts.locale,
      timezoneId: opts.timezoneId,
      // One context per run, never shared: cookies and storage must not leak across
      // runs, which is both a correctness bug and a tenancy violation.
      acceptDownloads: false,
    });

    // Masking `navigator.webdriver` is not evasion for its own sake — default Playwright
    // fingerprints trip bot walls on ordinary public marketing pages, turning a
    // legitimate read into a false failure the human then has to investigate.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await context.newPage();
    const session: Session = {
      id: `pw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      runId: opts.runId,
      driver: this.kind,
      createdAt: new Date().toISOString(),
      liveViewUrl: null,
    };

    this.sessions.set(session.id, {
      session,
      context,
      page,
      refs: new Map(),
      robots: ALLOW_ALL,
      allowedHosts: opts.allowedHosts,
      respectRobots: opts.respectRobotsTxt,
      humanControl: false,
      lastSnapshotHash: null,
    });

    return session;
  }

  /**
   * Adopt a browser that was connected elsewhere.
   *
   * The Browserbase driver owns the connection but reuses every page mechanic here, so
   * it hands the connected browser over rather than duplicating snapshot, action and
   * capture logic that would then have to be kept in sync.
   */
  async adoptRemote(session: Session, browser: Browser, opts: SessionOptions): Promise<void> {
    const context =
      browser.contexts()[0] ??
      (await browser.newContext({ viewport: opts.viewport, locale: opts.locale }));
    const page = context.pages()[0] ?? (await context.newPage());

    this.sessions.set(session.id, {
      session,
      context,
      page,
      refs: new Map(),
      robots: ALLOW_ALL,
      allowedHosts: opts.allowedHosts,
      respectRobots: opts.respectRobotsTxt,
      humanControl: false,
      lastSnapshotHash: null,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (!live) return;
    await live.context.close();
    this.sessions.delete(sessionId);
  }

  private async loadRobots(live: LiveSession, url: string): Promise<void> {
    if (!live.respectRobots) return;
    const origin = new URL(url).origin;
    try {
      const response = await live.page.request.get(`${origin}/robots.txt`, { timeout: 5_000 });
      live.robots = response.ok() ? parseRobots(await response.text()) : ALLOW_ALL;
    } catch {
      // An unreachable robots.txt means no restrictions were published, which the
      // standard treats as permission.
      live.robots = ALLOW_ALL;
    }
  }

  async navigate(session: Session, url: string): Promise<NavResult> {
    const live = this.live(session.id);
    const started = Date.now();

    const host = new URL(url).hostname.toLowerCase();
    if (live.allowedHosts.length > 0 && !hostAllowed(host, live.allowedHosts)) {
      // Enforced by the driver, not only by the model: a successful prompt injection
      // must not be able to send the browser anywhere the plan did not declare.
      throw new DomainNotAllowedError(url);
    }

    await this.loadRobots(live, url);
    if (live.respectRobots && !isUrlAllowed(live.robots, url)) throw new RobotsDisallowedError(url);

    const response = await live.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    return {
      url: live.page.url(),
      title: await live.page.title(),
      status: response?.status() ?? null,
      redirected: response !== null && response.url() !== url,
      durationMs: Date.now() - started,
    };
  }

  /**
   * Resolve a numeric ref back to a live locator.
   *
   * Refs are minted by our snapshot and resolved through Playwright's role locators, so
   * a ref that no longer matches throws `StaleRefError` instead of acting on whatever now
   * occupies those coordinates. That is the whole argument for refs over selectors:
   * silent wrong actions become loud failures.
   */
  private locatorFor(live: LiveSession, ref: number) {
    const target = live.refs.get(ref);
    if (!target) throw new StaleRefError(ref);
    const byRole = live.page.getByRole(target.role as Parameters<Page['getByRole']>[0], {
      name: target.name.length > 0 ? target.name : undefined,
      exact: true,
    });
    return byRole.first();
  }

  async act(session: Session, action: BrowserAction): Promise<ActionResult> {
    const live = this.live(session.id);
    const started = Date.now();
    const urlBefore = live.page.url();

    switch (action.type) {
      case 'navigate': {
        const result = await this.navigate(session, action.url);
        return { durationMs: result.durationMs, navigated: true };
      }
      case 'click':
        await this.locatorFor(live, action.ref).click({ timeout: 5_000 });
        break;
      case 'type':
        await this.locatorFor(live, action.ref).fill(action.text, { timeout: 5_000 });
        break;
      case 'select':
        await this.locatorFor(live, action.ref).selectOption(action.value, { timeout: 5_000 });
        break;
      case 'scroll':
        await live.page.mouse.wheel(
          0,
          action.direction === 'down' ? action.pixels : -action.pixels,
        );
        break;
      case 'wait_for':
        if (action.ref !== undefined) {
          await this.locatorFor(live, action.ref).waitFor({ state: 'visible', timeout: 15_000 });
        } else {
          await live.page.waitForTimeout(action.milliseconds ?? 1_000);
        }
        break;
      case 'press':
        await live.page.keyboard.press(action.key);
        break;
      case 'screenshot':
      case 'extract_ready':
      case 'give_up':
        // Read-only actions with no page effect; the caller handles the outcome.
        break;
      default:
        return assertNever(action, 'Unhandled browser action');
    }

    // Let the page settle before the caller compares snapshots, so a slow re-render is
    // not misread as a no-op.
    await live.page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);

    return { durationMs: Date.now() - started, navigated: live.page.url() !== urlBefore };
  }

  async snapshot(session: Session): Promise<PageSnapshot> {
    const live = this.live(session.id);

    // The accessibility tree already carries the DOM facts, joined by backendDOMNodeId.
    // Merging a second, name-matched set here is what previously gave a heading the href
    // of a same-named link.
    const [axRoot, scrollY] = await Promise.all([
      getAccessibilityTree(live.page),
      live.page.evaluate<number>('window.scrollY'),
    ]);

    const raw: RawAxNode = axRoot ?? {
      role: 'RootWebArea',
      name: await live.page.title(),
      children: [],
    };

    const compressed = compressAxTree(raw, {
      ...DEFAULT_COMPRESS_OPTIONS,
      viewportHeight: live.page.viewportSize()?.height ?? 800,
      scrollY,
    });

    live.refs = new Map(
      [...compressed.elements.entries()].map(([ref, element]) => [
        ref,
        { role: element.role, name: element.name },
      ]),
    );
    live.lastSnapshotHash = contentHash(compressed.tree);

    return {
      url: live.page.url(),
      title: await live.page.title(),
      tree: compressed.tree,
      elements: compressed.elements,
      boxes: compressed.boxes,
      scrollY,
      contentHash: contentHash(compressed.tree),
      nodeCount: compressed.nodeCount,
      capturedAt: new Date().toISOString(),
    };
  }

  async screenshot(session: Session, opts: ShotOptions = {}): Promise<Buffer> {
    const live = this.live(session.id);
    return live.page.screenshot({
      type: 'jpeg',
      quality: opts.quality ?? 70,
      fullPage: opts.fullPage ?? false,
      ...(opts.clip ? { clip: opts.clip } : {}),
    });
  }

  async capture(session: Session): Promise<PageCapture> {
    const live = this.live(session.id);
    const snapshot = await this.snapshot(session);
    const [html, screenshot, cookies] = await Promise.all([
      live.page.content(),
      this.screenshot(session),
      live.context.cookies(),
    ]);
    return {
      url: snapshot.url,
      title: snapshot.title,
      html,
      a11y: snapshot.tree,
      screenshot,
      contentHash: snapshot.contentHash,
      scrollY: snapshot.scrollY,
      cookies: JSON.stringify(cookies),
      capturedAt: snapshot.capturedAt,
    };
  }

  liveViewUrl(_session: Session): Promise<string | null> {
    // Local Chromium has no embeddable view; the UI falls back to the screenshot stream.
    return Promise.resolve(null);
  }

  grantHumanControl(session: Session): Promise<void> {
    this.live(session.id).humanControl = true;
    return Promise.resolve();
  }

  async revokeHumanControl(session: Session): Promise<PageSnapshot> {
    const live = this.live(session.id);
    live.humanControl = false;
    // Re-read rather than trusting the pre-takeover snapshot: the person may have
    // scrolled, clicked or navigated, and resuming against a stale view is exactly how
    // an agent clicks the wrong thing.
    return this.snapshot(session);
  }

  async restoreCookies(session: Session, cookiesJson: string): Promise<void> {
    const live = this.live(session.id);
    await live.context.clearCookies();
    await live.context.addCookies(
      JSON.parse(cookiesJson) as Parameters<BrowserContext['addCookies']>[0],
    );
  }

  async scrollTo(session: Session, y: number): Promise<void> {
    await this.live(session.id).page.evaluate(`window.scrollTo(0, ${String(y)})`);
  }

  async boxFor(session: Session, ref: number): Promise<BoundingBox | null> {
    const box = await this.locatorFor(this.live(session.id), ref).boundingBox();
    return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
  }

  async shutdown(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
    await this.browser?.close();
    this.browser = null;
  }
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    const base = entry.toLowerCase().replace(/^www\./, '');
    return host === base || host.endsWith(`.${base}`);
  });
}

export { DEFAULT_SESSION_OPTIONS };
