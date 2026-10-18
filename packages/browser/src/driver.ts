import type { BrowserAction, ElementDescriptor } from '@quorum/core';

export type DriverKind = 'playwright' | 'browserbase' | 'mock';

export interface SessionOptions {
  runId: string;
  viewport: { width: number; height: number };
  userAgent?: string;
  locale: string;
  timezoneId: string;
  /** Hosts the plan declared. Enforced by the driver, not only by the model. */
  allowedHosts: readonly string[];
  respectRobotsTxt: boolean;
}

export interface Session {
  id: string;
  runId: string;
  driver: DriverKind;
  createdAt: string;
  /** Present only for drivers that expose an embeddable interactive view. */
  liveViewUrl: string | null;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The model's primary input: a compressed, ref-annotated accessibility tree.
 * ~2–4k tokens versus 50–200k for raw HTML, with HIGHER action precision, because
 * refs resolve server-side to real element handles instead of coordinates that drift.
 */
export interface PageSnapshot {
  url: string;
  title: string;
  /** Rendered, model-facing text form of the tree. */
  tree: string;
  /** ref -> descriptor. Handles themselves never leave the driver. */
  elements: ReadonlyMap<number, ElementDescriptor>;
  boxes: ReadonlyMap<number, BoundingBox>;
  scrollY: number;
  /** Hash of `tree`. Comparing it before and after an action is how a click that
   *  changed nothing becomes a loud, typed failure instead of a silent loop. */
  contentHash: string;
  nodeCount: number;
  capturedAt: string;
}

export interface NavResult {
  url: string;
  title: string;
  status: number | null;
  redirected: boolean;
  durationMs: number;
}

export interface ActionResult {
  durationMs: number;
  navigated: boolean;
  /** Populated for actions that read rather than mutate. */
  text?: string;
}

export interface ShotOptions {
  fullPage?: boolean;
  quality?: number;
  clip?: BoundingBox;
}

export interface PageCapture {
  /** Rendered page text without accessibility refs/roles, for verbatim evidence quotes. */
  text?: string;
  url: string;
  title: string;
  html: string;
  a11y: string;
  screenshot: Buffer;
  contentHash: string;
  scrollY: number;
  cookies: string;
  capturedAt: string;
}

/**
 * The single interface every browser backend implements. The agent runtime never
 * imports Playwright or Browserbase directly — it depends only on this, which buys
 * free local development, vendor-switching insurance, and (most importantly) a
 * MockDriver that makes the whole agent pipeline deterministically testable in CI.
 */
export interface BrowserDriver {
  readonly kind: DriverKind;

  createSession(opts: SessionOptions): Promise<Session>;
  closeSession(sessionId: string): Promise<void>;

  navigate(session: Session, url: string): Promise<NavResult>;
  act(session: Session, action: BrowserAction): Promise<ActionResult>;

  snapshot(session: Session): Promise<PageSnapshot>;
  screenshot(session: Session, opts?: ShotOptions): Promise<Buffer>;
  capture(session: Session): Promise<PageCapture>;
  streamScreencast(
    session: Session,
    onFrame: (buffer: Buffer) => void,
  ): Promise<() => Promise<void>>;

  liveViewUrl(session: Session): Promise<string | null>;

  /** Human takeover: unlock input, then relock and re-read the page. */
  grantHumanControl(session: Session): Promise<void>;
  revokeHumanControl(session: Session): Promise<PageSnapshot>;

  restoreCookies(session: Session, cookiesJson: string): Promise<void>;
  scrollTo(session: Session, y: number): Promise<void>;
}

export interface PaginationStrategy {
  maxPages: number;
  mode: 'click_next' | 'infinite_scroll' | 'url_param';
}

export const DEFAULT_SESSION_OPTIONS: Omit<SessionOptions, 'runId' | 'allowedHosts'> = {
  viewport: { width: 1280, height: 800 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
  respectRobotsTxt: true,
};
