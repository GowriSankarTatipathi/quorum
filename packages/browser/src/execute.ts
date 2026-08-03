import {
  ACTION_TIMEOUTS_MS,
  ClassifiedActionError,
  classifyBrowserError,
  isClassifiedActionError,
  isIrreversible,
  throwable,
  trustLadder,
  type AutonomyMode,
  type BrowserAction,
  type ClassifiedError,
  type TrustVerdict,
} from '@quorum/core';
import type { ActionResult, BoundingBox, BrowserDriver, PageSnapshot, Session } from './driver.js';

export class ApprovalRequiredError extends Error {
  constructor(
    readonly action: BrowserAction,
    readonly verdict: TrustVerdict,
  ) {
    super(`Action requires approval at trust level L${String(verdict.level)}`);
    this.name = 'ApprovalRequiredError';
  }
}

export class ActionTimeoutError extends Error {
  constructor(action: BrowserAction, timeoutMs: number) {
    super(`Action ${action.type} exceeded ${String(timeoutMs)}ms`);
    this.name = 'ActionTimeoutError';
  }
}

export interface UndoFrameCapture {
  url: string;
  scrollY: number;
  html: string;
  a11y: string;
  screenshot: Buffer;
  cookies: string;
  reversible: boolean;
}

export interface ExecuteContext {
  mode: AutonomyMode;
  allowedHosts: readonly string[];
  /** Present when a human has already authorised this action. */
  approvalToken?: string;
  /** Consent granted for the rest of the run at this trust level. */
  runScopedConsent?: boolean;
  onEvent?: (event: ExecutionEvent) => void | Promise<void>;
  /** Captures the state needed to reverse this action. */
  captureUndo?: (frame: UndoFrameCapture) => void | Promise<void>;
}

export type ExecutionEvent =
  | {
      type: 'action.start';
      action: BrowserAction;
      verdict: TrustVerdict;
      highlight: BoundingBox | null;
    }
  | { type: 'action.ok'; action: BrowserAction; durationMs: number; changed: boolean }
  | { type: 'action.failed'; action: BrowserAction; error: ClassifiedError }
  | { type: 'noop.detected'; action: BrowserAction; ref: number | null };

export interface ExecuteResult {
  result: ActionResult;
  snapshotAfter: PageSnapshot;
  changed: boolean;
}

/** Actions that observe rather than alter; comparing snapshots around them is meaningless. */
const READ_ONLY = new Set(['screenshot', 'extract_ready', 'give_up', 'wait_for', 'scroll']);

function refOf(action: BrowserAction): number | null {
  return 'ref' in action && typeof action.ref === 'number' ? action.ref : null;
}

async function withTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  action: BrowserAction,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ActionTimeoutError(action, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute one browser action.
 *
 * Three guarantees, in order:
 *
 *  1. Nothing at or above the workspace's gate threshold runs without an approval token.
 *     The check is a pure function of the action and the mode, so no page content and no
 *     model output can influence it.
 *  2. Everything reversible is captured first, so ⌘Z has something to restore.
 *  3. A click that changes nothing becomes a typed error rather than an invisible
 *     failure. "The agent clicked, nothing happened, the agent clicked again" is the most
 *     common way a browser agent burns a run, and the model usually cannot tell —
 *     the screenshot looks the same because it *is* the same. Comparing content hashes
 *     turns that into something Recovery can act on, for the price of one comparison.
 */
export async function executeAction(
  driver: BrowserDriver,
  session: Session,
  action: BrowserAction,
  snapshotBefore: PageSnapshot,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const verdict = trustLadder(action, ctx.mode, { allowedHosts: ctx.allowedHosts });

  const needsApproval = verdict.requiresApproval && !ctx.runScopedConsent;
  if (needsApproval && !ctx.approvalToken) throw new ApprovalRequiredError(action, verdict);

  const highlight =
    refOf(action) === null ? null : (snapshotBefore.boxes.get(refOf(action)!) ?? null);
  // Emitted before the action so the interface can highlight the target and the human can
  // hit pause *before* a bad click rather than after it.
  await ctx.onEvent?.({ type: 'action.start', action, verdict, highlight });

  if (ctx.captureUndo && !READ_ONLY.has(action.type)) {
    const capture = await driver.capture(session);
    await ctx.captureUndo({
      url: capture.url,
      scrollY: capture.scrollY,
      html: capture.html,
      a11y: capture.a11y,
      screenshot: capture.screenshot,
      cookies: capture.cookies,
      // An irreversible action poisons the frame it produces: restoring the page would
      // not un-send what was sent, and undo that quietly does less than it claims is
      // worse than undo that honestly refuses.
      reversible: !isIrreversible(action, { allowedHosts: ctx.allowedHosts }),
    });
  }

  try {
    const result = await withTimeout(
      () => driver.act(session, action),
      ACTION_TIMEOUTS_MS[action.type],
      action,
    );

    const snapshotAfter = await driver.snapshot(session);
    const changed = snapshotAfter.contentHash !== snapshotBefore.contentHash;

    if (!READ_ONLY.has(action.type) && !changed && !result.navigated) {
      await ctx.onEvent?.({ type: 'noop.detected', action, ref: refOf(action) });
      throw throwable('NO_OP_ACTION', `${action.type} produced no observable change to the page`);
    }

    await ctx.onEvent?.({
      type: 'action.ok',
      action,
      durationMs: result.durationMs,
      changed,
    });

    return { result, snapshotAfter, changed };
  } catch (error) {
    const failure = isClassifiedActionError(error)
      ? error
      : new ClassifiedActionError(classifyBrowserError(error));
    await ctx.onEvent?.({ type: 'action.failed', action, error: failure.toClassified() });
    throw failure;
  }
}
