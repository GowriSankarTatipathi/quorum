import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIDDLEWARE_MATCHER, isAuthRoute, requiresAuth, safeCallbackUrl } from './route-policy';

describe('requiresAuth', () => {
  it('protects application routes and their children', () => {
    for (const path of [
      '/account',
      '/account/security',
      '/runs',
      '/runs/abc',
      '/usage',
      '/recipes',
    ]) {
      expect(requiresAuth(path)).toBe(true);
    }
  });

  it('leaves public routes alone', () => {
    for (const path of ['/', '/signin', '/verify-request', '/auth-error']) {
      expect(requiresAuth(path)).toBe(false);
    }
  });

  it('does not protect a prefix that merely starts with the same characters', () => {
    // `/runsheet` is not under `/runs`, and a naive startsWith check would say it is.
    expect(requiresAuth('/runsheet')).toBe(false);
    expect(requiresAuth('/accounts-payable')).toBe(false);
  });
});

describe('isAuthRoute', () => {
  it('recognises the sign-in surfaces a signed-in user should be bounced from', () => {
    expect(isAuthRoute('/signin')).toBe(true);
    expect(isAuthRoute('/verify-request')).toBe(true);
  });

  it('does not include the error page, which a signed-in user may still need', () => {
    expect(isAuthRoute('/auth-error')).toBe(false);
  });
});

describe('safeCallbackUrl', () => {
  it('keeps ordinary relative paths, including query strings', () => {
    expect(safeCallbackUrl('/runs/abc?step=4')).toBe('/runs/abc?step=4');
  });

  it('rejects absolute urls', () => {
    expect(safeCallbackUrl('https://evil.example/steal')).toBe('/account');
  });

  it('rejects protocol-relative urls, which look relative and are not', () => {
    expect(safeCallbackUrl('//evil.example/steal')).toBe('/account');
    expect(safeCallbackUrl('/\\evil.example')).toBe('/account');
  });

  it('falls back for empty input', () => {
    expect(safeCallbackUrl(null)).toBe('/account');
    expect(safeCallbackUrl(undefined)).toBe('/account');
    expect(safeCallbackUrl('')).toBe('/account');
  });

  it('honours a caller-supplied fallback', () => {
    expect(safeCallbackUrl(null, '/')).toBe('/');
  });
});

describe('middleware matcher', () => {
  // Next matches the full pathname, leading slash included.
  const pattern = new RegExp(`^${MIDDLEWARE_MATCHER}$`);
  const matches = (path: string): boolean => pattern.test(path);

  it('runs on protected application routes', () => {
    for (const path of ['/account', '/account/security', '/runs/abc', '/usage']) {
      expect(matches(path)).toBe(true);
    }
  });

  it('runs on the landing page, which renders session-aware chrome', () => {
    expect(matches('/')).toBe(true);
  });

  it('never runs on the auth endpoints it exists to protect access to', () => {
    expect(matches('/api/auth/signin')).toBe(false);
    expect(matches('/api/auth/callback/google')).toBe(false);
  });

  it('skips static assets and fonts', () => {
    for (const path of [
      '/_next/static/chunk.js',
      '/_next/image',
      '/favicon.ico',
      '/logo.svg',
      '/inter.woff2',
    ]) {
      expect(matches(path)).toBe(false);
    }
  });
});

describe('matcher stays in sync with middleware.ts', () => {
  /**
   * Next statically analyses `export const config` and cannot resolve an imported
   * constant, so the pattern is duplicated as a literal there. Duplication is only safe
   * if drift is detectable, which is what this asserts.
   */
  it('the literal in middleware.ts is byte-identical to the tested constant', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../middleware.ts', import.meta.url)),
      'utf8',
    );
    const match = /matcher:\s*\[\s*'([^']+)'/.exec(source);
    expect(match, 'middleware.ts must export a literal matcher array').not.toBeNull();
    // The source contains an escaped backslash; unescape it to compare runtime values.
    expect(match![1]!.replace(/\\\\/g, '\\')).toBe(MIDDLEWARE_MATCHER);
  });
});
