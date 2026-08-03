import { ACTION_TIMEOUTS_MS, type BrowserActionType } from '@quorum/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_OPTIONS } from './driver.js';

describe('session defaults', () => {
  it('uses the viewport the cost and latency benchmarks were measured at', () => {
    expect(DEFAULT_SESSION_OPTIONS.viewport).toEqual({ width: 1280, height: 800 });
  });

  it('respects robots.txt by default — the honest default is also the correct one', () => {
    expect(DEFAULT_SESSION_OPTIONS.respectRobotsTxt).toBe(true);
  });

  it('pins locale and timezone so extraction is not silently locale-dependent', () => {
    expect(DEFAULT_SESSION_OPTIONS.locale).toBe('en-US');
    expect(DEFAULT_SESSION_OPTIONS.timezoneId).toBeTruthy();
  });
});

describe('action timeouts', () => {
  const types: BrowserActionType[] = [
    'navigate',
    'click',
    'type',
    'select',
    'scroll',
    'wait_for',
    'press',
    'screenshot',
    'extract_ready',
    'give_up',
  ];

  it('covers every action in the vocabulary', () => {
    for (const t of types) expect(ACTION_TIMEOUTS_MS[t]).toBeGreaterThan(0);
    expect(Object.keys(ACTION_TIMEOUTS_MS).sort()).toEqual([...types].sort());
  });

  it('gives navigation far longer than a click, which is the point of per-type timeouts', () => {
    expect(ACTION_TIMEOUTS_MS.navigate).toBeGreaterThan(ACTION_TIMEOUTS_MS.click * 3);
  });
});
