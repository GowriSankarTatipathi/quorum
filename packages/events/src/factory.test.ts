import { describe, expect, it } from 'vitest';
import { SequenceCounter, createEvent, runChannel } from './factory.js';

describe('SequenceCounter', () => {
  it('produces a strictly increasing sequence per run', () => {
    const c = new SequenceCounter();
    expect(c.next('a')).toBe(1);
    expect(c.next('a')).toBe(2);
    expect(c.next('b')).toBe(1);
  });

  it('resumes from a seeded value so client cursors survive a worker restart', () => {
    const c = new SequenceCounter();
    c.seed('a', 42);
    expect(c.next('a')).toBe(43);
  });
});

describe('createEvent', () => {
  it('mints sortable ids and carries causal metadata', () => {
    const e1 = createEvent(
      'run.created',
      { goal: 'g', mode: 'BALANCED', budgetUsd: 0.5 },
      { runId: 'r' },
      1,
    );
    const e2 = createEvent('human.paused', { by: 'u1' }, { runId: 'r', correlationId: e1.id }, 2);
    expect(e2.id > e1.id).toBe(true);
    expect(e2.correlationId).toBe(e1.id);
    expect(e1.payload.goal).toBe('g');
  });

  /**
   * A fast agent emits dozens of events per millisecond. If ids generated inside the
   * same tick sorted arbitrarily, "replay everything after cursor X" would occasionally
   * skip or duplicate an event on reconnect — a bug that would appear only under load
   * and be nearly impossible to reproduce.
   */
  it('is strictly ordered even for events minted within the same millisecond', () => {
    const ids = Array.from(
      { length: 500 },
      (_, i) => createEvent('human.paused', { by: 'u1' }, { runId: 'r' }, i + 1).id,
    );
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('runChannel', () => {
  it('namespaces per run', () => {
    expect(runChannel('abc')).toBe('run:abc:events');
  });
});
