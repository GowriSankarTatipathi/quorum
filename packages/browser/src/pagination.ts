import type { ElementDescriptor } from '@quorum/core';
import type { PageSnapshot, PaginationStrategy } from './driver.js';

export type PaginationOutcome =
  | { kind: 'page'; page: number; snapshot: PageSnapshot }
  | { kind: 'loop_detected'; page: number }
  | { kind: 'exhausted'; pages: number }
  | { kind: 'capped'; pages: number };

/** Accessible names that advance a listing, ordered by how specific they are. */
const NEXT_NAMES = [
  'next page',
  'next',
  'load more',
  'show more',
  'see more',
  'more results',
  '›',
  '→',
  '»',
];

const normalize = (value: string): string => value.trim().toLowerCase();

/**
 * Find the control that advances the listing.
 *
 * A disabled control is treated as absent: many sites leave "Next" enabled on the last
 * page and simply stop advancing, which is exactly the case the loop guard below exists
 * for, but a genuinely disabled button should end pagination cleanly rather than
 * consuming a wasted click and a snapshot.
 */
export function findNextControl(snapshot: PageSnapshot): ElementDescriptor | null {
  const candidates = [...snapshot.elements.values()].filter(
    (element) => element.role === 'button' || element.role === 'link',
  );

  for (const name of NEXT_NAMES) {
    const match = candidates.find((element) => normalize(element.name) === name);
    if (match) return match;
  }
  for (const name of NEXT_NAMES) {
    const match = candidates.find((element) => normalize(element.name).includes(name));
    if (match) return match;
  }
  return null;
}

export interface PaginationDriver {
  snapshot(): Promise<PageSnapshot>;
  clickRef(ref: number): Promise<void>;
  waitForChange(previousHash: string, timeoutMs: number): Promise<void>;
  scrollToBottom(): Promise<void>;
}

export const DEFAULT_PAGINATION: PaginationStrategy = { maxPages: 20, mode: 'click_next' };

/**
 * Walk a paginated listing.
 *
 * The content-hash set is the load-bearing part. "Next" buttons that stop advancing while
 * remaining enabled are extremely common, and without this guard the agent extracts the
 * same page twenty times and hands the Critic twenty duplicates to clean up at real cost.
 * Detecting it at the source is a one-`Set` fix.
 *
 * Reaching the cap emits an outcome rather than failing: truncation is often acceptable,
 * but it must never be silent. The event becomes a visible note on the result — honest
 * incompleteness beats invisible incompleteness, the same principle as a null with a
 * reason.
 */
export async function* paginate(
  driver: PaginationDriver,
  strategy: PaginationStrategy = DEFAULT_PAGINATION,
  waitTimeoutMs = 5_000,
): AsyncGenerator<PaginationOutcome> {
  const seen = new Set<string>();

  for (let page = 1; page <= strategy.maxPages; page += 1) {
    const snapshot = await driver.snapshot();

    if (seen.has(snapshot.contentHash)) {
      yield { kind: 'loop_detected', page };
      return;
    }
    seen.add(snapshot.contentHash);
    yield { kind: 'page', page, snapshot };

    if (strategy.mode === 'infinite_scroll') {
      await driver.scrollToBottom();
      try {
        await driver.waitForChange(snapshot.contentHash, waitTimeoutMs);
      } catch {
        yield { kind: 'exhausted', pages: page };
        return;
      }
      continue;
    }

    const next = findNextControl(snapshot);
    if (!next) {
      yield { kind: 'exhausted', pages: page };
      return;
    }

    await driver.clickRef(next.ref);
    try {
      await driver.waitForChange(snapshot.contentHash, waitTimeoutMs);
    } catch {
      // The control existed and was clicked, but nothing changed — the same silent
      // failure the no-op detector catches for single actions.
      yield { kind: 'exhausted', pages: page };
      return;
    }
  }

  yield { kind: 'capped', pages: strategy.maxPages };
}
