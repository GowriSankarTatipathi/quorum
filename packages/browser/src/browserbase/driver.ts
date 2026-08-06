import type { BrowserAction } from '@quorum/core';
import { chromium, type Browser } from 'playwright-core';
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
import { PlaywrightDriver } from '../playwright/driver.js';

export interface BrowserbaseOptions {
  apiKey: string;
  projectId: string;
  apiUrl?: string;
}

interface BrowserbaseSessionResponse {
  id: string;
  connectUrl?: string;
  status?: string;
}

/**
 * Managed Chromium, connected over CDP.
 *
 * The reason to buy rather than build: Browserbase supplies an embeddable live-view URL
 * and session replay, which the split-screen interface depends on and which would
 * otherwise be weeks of work plus ongoing operations. Everything above the connection is
 * the same Playwright code path, which is the payoff for having a driver interface at
 * all — production and local development differ by one environment variable, not by a
 * parallel implementation.
 */
export class BrowserbaseDriver implements BrowserDriver {
  readonly kind = 'browserbase' as const;
  private readonly apiUrl: string;
  private readonly remote = new Map<string, { browserbaseId: string; browser: Browser }>();
  private readonly inner: PlaywrightDriver;

  constructor(private readonly options: BrowserbaseOptions) {
    this.apiUrl = options.apiUrl ?? 'https://api.browserbase.com';
    // Session and page mechanics are identical once connected, so the local driver is
    // reused rather than reimplemented.
    this.inner = new PlaywrightDriver();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-bb-api-key': this.options.apiKey,
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Browserbase ${path} responded ${String(response.status)}: ${(await response.text()).slice(0, 300)}`,
      );
    }
    return (await response.json()) as T;
  }

  async createSession(opts: SessionOptions): Promise<Session> {
    const created = await this.request<BrowserbaseSessionResponse>('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({
        projectId: this.options.projectId,
        browserSettings: {
          viewport: opts.viewport,
          context: { persist: false },
        },
        keepAlive: false,
      }),
    });

    const connectUrl =
      created.connectUrl ??
      `wss://connect.browserbase.com?apiKey=${this.options.apiKey}&sessionId=${created.id}`;
    const browser = await chromium.connectOverCDP(connectUrl);

    const session: Session = {
      id: `bb_${created.id}`,
      runId: opts.runId,
      driver: this.kind,
      createdAt: new Date().toISOString(),
      liveViewUrl: await this.fetchLiveViewUrl(created.id),
    };

    this.remote.set(session.id, { browserbaseId: created.id, browser });
    await this.inner.adoptRemote(session, browser, opts);
    return session;
  }

  private async fetchLiveViewUrl(browserbaseId: string): Promise<string | null> {
    try {
      const debug = await this.request<{ debuggerFullscreenUrl?: string; debuggerUrl?: string }>(
        `/v1/sessions/${browserbaseId}/debug`,
      );
      return debug.debuggerFullscreenUrl ?? debug.debuggerUrl ?? null;
    } catch {
      // A missing live view degrades the UI to the screenshot stream; it must not stop
      // the run, because the run is the thing the customer is paying for.
      return null;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const remote = this.remote.get(sessionId);
    await this.inner.closeSession(sessionId);
    if (!remote) return;
    this.remote.delete(sessionId);
    await remote.browser.close().catch(() => undefined);
    await this.request(`/v1/sessions/${remote.browserbaseId}`, {
      method: 'POST',
      body: JSON.stringify({ projectId: this.options.projectId, status: 'REQUEST_RELEASE' }),
    }).catch(() => undefined);
  }

  navigate(session: Session, url: string): Promise<NavResult> {
    return this.inner.navigate(session, url);
  }
  act(session: Session, action: BrowserAction): Promise<ActionResult> {
    return this.inner.act(session, action);
  }
  snapshot(session: Session): Promise<PageSnapshot> {
    return this.inner.snapshot(session);
  }
  screenshot(session: Session, opts?: ShotOptions): Promise<Buffer> {
    return this.inner.screenshot(session, opts);
  }

  streamScreencast(
    session: Session,
    onFrame: (buffer: Buffer) => void,
  ): Promise<() => Promise<void>> {
    return this.inner.streamScreencast(session, onFrame);
  }
  capture(session: Session): Promise<PageCapture> {
    return this.inner.capture(session);
  }
  liveViewUrl(session: Session): Promise<string | null> {
    return Promise.resolve(session.liveViewUrl);
  }
  grantHumanControl(session: Session): Promise<void> {
    return this.inner.grantHumanControl(session);
  }
  revokeHumanControl(session: Session): Promise<PageSnapshot> {
    return this.inner.revokeHumanControl(session);
  }
  restoreCookies(session: Session, cookiesJson: string): Promise<void> {
    return this.inner.restoreCookies(session, cookiesJson);
  }
  scrollTo(session: Session, y: number): Promise<void> {
    return this.inner.scrollTo(session, y);
  }
}
