import { describe, expect, it } from 'vitest';
import { artifactKeys, downloadFilename } from './keys.js';

describe('artifactKeys', () => {
  it('nests every artifact under one run prefix, so erasure is a prefix delete', () => {
    const prefix = artifactKeys.runPrefix('run_1');
    expect(artifactKeys.screenshot('run_1', 'stp_1', 3).startsWith(prefix)).toBe(true);
    expect(artifactKeys.domSnapshot('run_1', 'stp_1', 3).startsWith(prefix)).toBe(true);
    expect(artifactKeys.export('run_1', 'xlsx', 123).startsWith(prefix)).toBe(true);
  });

  it('zero-pads sequences so keys sort in capture order', () => {
    const keys = [9, 10, 100].map((seq) => artifactKeys.screenshot('r', 's', seq));
    expect([...keys].sort()).toEqual(keys);
  });

  it('does not let one run’s prefix match another’s', () => {
    expect(
      artifactKeys.screenshot('run_10', 's', 1).startsWith(artifactKeys.runPrefix('run_1')),
    ).toBe(false);
  });
});

describe('downloadFilename', () => {
  it('produces something recognisable in a Downloads folder weeks later', () => {
    expect(
      downloadFilename('Get pricing tiers for Ramp and Brex', 'xlsx', new Date('2026-08-02')),
    ).toBe('quorum-get-pricing-tiers-for-ramp-and-brex-2026-08-02.xlsx');
  });

  it('strips characters that break a filesystem', () => {
    const name = downloadFilename('a/b\\c:d*e?"f<g>h|i', 'csv', new Date('2026-08-02'));
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('falls back when the goal yields nothing usable', () => {
    expect(downloadFilename('!!!', 'json', new Date('2026-08-02'))).toBe(
      'quorum-run-2026-08-02.json',
    );
  });
});
