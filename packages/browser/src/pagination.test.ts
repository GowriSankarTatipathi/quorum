import { describe, expect, it } from 'vitest';
import type { ElementDescriptor } from '@quorum/core';
import type { PageSnapshot } from './driver.js';
import { findNextControl, paginate, type PaginationDriver } from './pagination.js';

function snapshot(hash: string, elements: ElementDescriptor[] = []): PageSnapshot {
  return {
    url: 'https://example.com/list',
    title: 'List',
    tree: hash,
    elements: new Map(elements.map((element) => [element.ref, element])),
    boxes: new Map(),
    scrollY: 0,
    contentHash: hash,
    nodeCount: elements.length,
    capturedAt: new Date().toISOString(),
  };
}

const nextButton: ElementDescriptor = { ref: 1, role: 'button', name: 'Next' };

/** A page sequence a driver walks through, so pagination is testable without a browser. */
class ScriptedDriver implements PaginationDriver {
  private index = 0;
  readonly clicks: number[] = [];

  constructor(
    private readonly pages: PageSnapshot[],
    private readonly options: { advances?: boolean } = {},
  ) {}

  snapshot(): Promise<PageSnapshot> {
    return Promise.resolve(this.pages[Math.min(this.index, this.pages.length - 1)]!);
  }
  clickRef(ref: number): Promise<void> {
    this.clicks.push(ref);
    if (this.options.advances !== false) this.index += 1;
    return Promise.resolve();
  }
  waitForChange(previousHash: string): Promise<void> {
    const current = this.pages[Math.min(this.index, this.pages.length - 1)]!;
    return current.contentHash === previousHash
      ? Promise.reject(new Error('no change'))
      : Promise.resolve();
  }
  scrollToBottom(): Promise<void> {
    this.index += 1;
    return Promise.resolve();
  }
}

const collect = async (driver: PaginationDriver, maxPages = 20) => {
  const outcomes = [];
  for await (const outcome of paginate(driver, { maxPages, mode: 'click_next' })) {
    outcomes.push(outcome);
  }
  return outcomes;
};

describe('findNextControl', () => {
  it('matches an exact name first', () => {
    expect(findNextControl(snapshot('a', [nextButton]))?.ref).toBe(1);
  });

  it('falls back to a partial match', () => {
    const control: ElementDescriptor = { ref: 3, role: 'button', name: 'Load more results' };
    expect(findNextControl(snapshot('a', [control]))?.ref).toBe(3);
  });

  it('recognises glyph-only controls', () => {
    expect(findNextControl(snapshot('a', [{ ref: 2, role: 'link', name: '→' }]))?.ref).toBe(2);
  });

  it('returns null when there is nothing to click', () => {
    expect(findNextControl(snapshot('a', [{ ref: 1, role: 'button', name: 'Filter' }]))).toBeNull();
  });

  it('ignores non-clickable roles', () => {
    expect(findNextControl(snapshot('a', [{ ref: 1, role: 'text', name: 'Next' }]))).toBeNull();
  });
});

describe('paginate', () => {
  it('walks pages until the control disappears', async () => {
    const outcomes = await collect(
      new ScriptedDriver([
        snapshot('p1', [nextButton]),
        snapshot('p2', [nextButton]),
        snapshot('p3'),
      ]),
    );
    expect(outcomes.filter((o) => o.kind === 'page')).toHaveLength(3);
    expect(outcomes.at(-1)).toEqual({ kind: 'exhausted', pages: 3 });
  });

  it('detects a Next button that stays enabled but stops advancing', async () => {
    // The common real-world case: without the hash guard this extracts the same page
    // twenty times and hands the Critic twenty duplicates.
    const driver = new ScriptedDriver([snapshot('same', [nextButton])], { advances: false });
    const outcomes = await collect(driver);
    expect(outcomes.filter((o) => o.kind === 'page')).toHaveLength(1);
    expect(outcomes.at(-1)?.kind).toBe('exhausted');
  });

  it('detects a genuine loop when a site cycles back to a seen page', async () => {
    const p1 = snapshot('p1', [nextButton]);
    const p2 = snapshot('p2', [nextButton]);
    let index = 0;
    const cycling: PaginationDriver = {
      snapshot: () => Promise.resolve([p1, p2, p1][index] ?? p1),
      clickRef: () => {
        index += 1;
        return Promise.resolve();
      },
      waitForChange: () => Promise.resolve(),
      scrollToBottom: () => Promise.resolve(),
    };
    const outcomes = await collect(cycling);
    expect(outcomes.at(-1)).toEqual({ kind: 'loop_detected', page: 3 });
  });

  it('caps runaway pagination and says so, rather than truncating silently', async () => {
    let counter = 0;
    const endless: PaginationDriver = {
      snapshot: () => {
        counter += 1;
        return Promise.resolve(snapshot(`p${String(counter)}`, [nextButton]));
      },
      clickRef: () => Promise.resolve(),
      waitForChange: () => Promise.resolve(),
      scrollToBottom: () => Promise.resolve(),
    };
    const outcomes = await collect(endless, 3);
    expect(outcomes.filter((o) => o.kind === 'page')).toHaveLength(3);
    expect(outcomes.at(-1)).toEqual({ kind: 'capped', pages: 3 });
  });

  it('supports infinite scroll', async () => {
    const outcomes = [];
    const driver = new ScriptedDriver([
      snapshot('s1'),
      snapshot('s2'),
      snapshot('s3'),
      snapshot('s3'),
    ]);
    for await (const outcome of paginate(driver, { maxPages: 10, mode: 'infinite_scroll' })) {
      outcomes.push(outcome);
    }
    expect(outcomes.filter((o) => o.kind === 'page')).toHaveLength(3);
    expect(outcomes.at(-1)?.kind).toBe('exhausted');
  });

  it('clicks exactly once per page transition', async () => {
    const driver = new ScriptedDriver([
      snapshot('p1', [nextButton]),
      snapshot('p2', [nextButton]),
      snapshot('p3'),
    ]);
    await collect(driver);
    expect(driver.clicks).toEqual([1, 1]);
  });
});
