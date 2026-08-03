import { describe, expect, it } from 'vitest';
import { ALLOW_ALL, isPathAllowed, isUrlAllowed, parseRobots } from './robots.js';

describe('parseRobots', () => {
  it('reads the wildcard group', () => {
    const policy = parseRobots('User-agent: *\nDisallow: /admin\nAllow: /admin/public');
    expect(policy.rules).toEqual([
      { type: 'disallow', path: '/admin' },
      { type: 'allow', path: '/admin/public' },
    ]);
  });

  it('prefers a group naming us over the wildcard', () => {
    const policy = parseRobots(
      ['User-agent: *', 'Disallow: /', '', 'User-agent: quorum', 'Disallow: /private'].join('\n'),
    );
    expect(policy.rules).toEqual([{ type: 'disallow', path: '/private' }]);
  });

  it('shares one rule group across consecutive user-agent lines', () => {
    const policy = parseRobots('User-agent: quorum\nUser-agent: other\nDisallow: /x');
    expect(policy.rules).toEqual([{ type: 'disallow', path: '/x' }]);
  });

  it('ignores comments and blank lines', () => {
    const policy = parseRobots('# hello\nUser-agent: *   # everyone\nDisallow: /a # secret\n\n');
    expect(policy.rules).toEqual([{ type: 'disallow', path: '/a' }]);
  });

  it('reads crawl-delay in milliseconds', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 2').crawlDelayMs).toBe(2_000);
    expect(parseRobots('User-agent: *').crawlDelayMs).toBeNull();
  });

  it('treats an empty file as allow-all', () => {
    expect(parseRobots('').rules).toEqual([]);
  });
});

describe('isPathAllowed', () => {
  const policy = parseRobots(
    ['User-agent: *', 'Disallow: /admin', 'Allow: /admin/public', 'Disallow: /*.pdf$'].join('\n'),
  );

  it('allows paths no rule matches', () => {
    expect(isPathAllowed(policy, '/pricing')).toBe(true);
  });

  it('blocks a disallowed prefix', () => {
    expect(isPathAllowed(policy, '/admin')).toBe(false);
    expect(isPathAllowed(policy, '/admin/settings')).toBe(false);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    expect(isPathAllowed(policy, '/admin/public/report')).toBe(true);
  });

  it('honours wildcard and end-anchor patterns', () => {
    expect(isPathAllowed(policy, '/files/report.pdf')).toBe(false);
    expect(isPathAllowed(policy, '/files/report.pdf?x=1')).toBe(true);
  });

  it('treats an empty Disallow as allow-everything', () => {
    expect(isPathAllowed(parseRobots('User-agent: *\nDisallow:'), '/anything')).toBe(true);
  });

  it('blocks everything under a bare Disallow: /', () => {
    expect(isPathAllowed(parseRobots('User-agent: *\nDisallow: /'), '/pricing')).toBe(false);
  });

  it('allows everything under an empty policy', () => {
    expect(isPathAllowed(ALLOW_ALL, '/anything')).toBe(true);
  });
});

describe('isUrlAllowed', () => {
  const policy = parseRobots('User-agent: *\nDisallow: /admin');

  it('checks the path and query of a full url', () => {
    expect(isUrlAllowed(policy, 'https://example.com/pricing')).toBe(true);
    expect(isUrlAllowed(policy, 'https://example.com/admin/x')).toBe(false);
  });

  it('refuses an unparseable url rather than fetching it optimistically', () => {
    expect(isUrlAllowed(policy, 'not a url')).toBe(false);
  });
});
