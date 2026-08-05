import type { BrowserAction } from '@quorum/core';
import type {
  ActionResult,
  BrowserDriver,
  NavResult,
  PageCapture,
  PageSnapshot,
  Session,
  SessionOptions,
  ShotOptions,
} from '../driver.js';
import {
  DEFAULT_COMPRESS_OPTIONS,
  compressAxTree,
  contentHash,
  type RawAxNode,
} from '../snapshot.js';

export interface FixturePage {
  url: string;
  title: string;
  ax: RawAxNode;
  html?: string;
  /** Applied when an action matches, producing the next page state. */
  transitions?: {
    match: (action: BrowserAction) => boolean;
    to: string;
  }[];
  /** Raised instead of acting, so failure paths are exercised as well as happy ones. */
  failOn?: { match: (action: BrowserAction) => boolean; error: Error }[];
}

/**
 * A driver backed by declared page states.
 *
 * This is a complete implementation of the port, not a stand-in for one: it is how the
 * agent runtime is exercised deterministically in CI with no browser, no network and no
 * flakiness. Testing against real sites would mean tests that fail when a vendor
 * redesigns a page — and a suite engineers learn to ignore is worse than no suite.
 */
export class FixtureDriver implements BrowserDriver {
  readonly kind = 'mock' as const;
  readonly actions: BrowserAction[] = [];
  private readonly sessions = new Map<string, { session: Session; currentUrl: string }>();

  constructor(
    private readonly pages: Map<string, FixturePage>,
    private readonly startUrl: string,
  ) {}

  private state(sessionId: string) {
    const state = this.sessions.get(sessionId);
    if (!state) throw new Error(`Fixture session ${sessionId} is not open`);
    return state;
  }

  private page(sessionId: string): FixturePage {
    const { currentUrl } = this.state(sessionId);
    const page = this.pages.get(currentUrl);
    if (!page) throw new Error(`No fixture page registered for ${currentUrl}`);
    return page;
  }

  createSession(opts: SessionOptions): Promise<Session> {
    const session: Session = {
      id: `fx_${String(this.sessions.size + 1)}`,
      runId: opts.runId,
      driver: this.kind,
      createdAt: new Date().toISOString(),
      liveViewUrl: null,
    };
    this.sessions.set(session.id, { session, currentUrl: this.startUrl });
    return Promise.resolve(session);
  }

  closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    return Promise.resolve();
  }

  navigate(session: Session, url: string): Promise<NavResult> {
    if (!this.pages.has(url)) return Promise.reject(new Error(`net::ERR_NAME_NOT_RESOLVED ${url}`));
    this.state(session.id).currentUrl = url;
    const page = this.pages.get(url)!;
    return Promise.resolve({
      url,
      title: page.title,
      status: 200,
      redirected: false,
      durationMs: 5,
    });
  }

  act(session: Session, action: BrowserAction): Promise<ActionResult> {
    this.actions.push(action);
    if (action.type === 'navigate') {
      return this.navigate(session, action.url).then((result) => ({
        durationMs: result.durationMs,
        navigated: true,
      }));
    }

    const page = this.page(session.id);
    const failure = page.failOn?.find((entry) => entry.match(action));
    if (failure) return Promise.reject(failure.error);

    const transition = page.transitions?.find((entry) => entry.match(action));
    const before = this.state(session.id).currentUrl;
    if (transition) this.state(session.id).currentUrl = transition.to;

    return Promise.resolve({
      durationMs: 1,
      navigated: this.state(session.id).currentUrl !== before,
    });
  }

  snapshot(session: Session): Promise<PageSnapshot> {
    const page = this.page(session.id);
    const compressed = compressAxTree(page.ax, DEFAULT_COMPRESS_OPTIONS);
    return Promise.resolve({
      url: page.url,
      title: page.title,
      tree: compressed.tree,
      elements: compressed.elements,
      boxes: compressed.boxes,
      scrollY: 0,
      contentHash: contentHash(compressed.tree),
      nodeCount: compressed.nodeCount,
      capturedAt: new Date().toISOString(),
    });
  }

  screenshot(_session: Session, _opts?: ShotOptions): Promise<Buffer> {
    // A one-pixel JPEG: real bytes with a real mime type, so storage and rendering paths
    // are exercised without embedding a fixture image in the repository.
    return Promise.resolve(
      Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
        'base64',
      ),
    );
  }

  streamScreencast(_session: Session, onFrame: (buffer: Buffer) => void): Promise<() => Promise<void>> {
    const timer = setInterval(() => {
      onFrame(Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'));
    }, 500);
    return Promise.resolve(() => {
      clearInterval(timer);
      return Promise.resolve();
    });
  }

  async capture(session: Session): Promise<PageCapture> {
    const snapshot = await this.snapshot(session);
    const page = this.page(session.id);
    return {
      url: snapshot.url,
      title: snapshot.title,
      html: page.html ?? `<html><head><title>${page.title}</title></head><body></body></html>`,
      a11y: snapshot.tree,
      screenshot: await this.screenshot(session),
      contentHash: snapshot.contentHash,
      scrollY: 0,
      cookies: '[]',
      capturedAt: snapshot.capturedAt,
    };
  }

  liveViewUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }

  grantHumanControl(): Promise<void> {
    return Promise.resolve();
  }

  revokeHumanControl(session: Session): Promise<PageSnapshot> {
    return this.snapshot(session);
  }

  restoreCookies(): Promise<void> {
    return Promise.resolve();
  }

  scrollTo(): Promise<void> {
    return Promise.resolve();
  }

  /** Test affordance: move the fixture to a page without going through an action. */
  goTo(sessionId: string, url: string): void {
    this.state(sessionId).currentUrl = url;
  }
}
