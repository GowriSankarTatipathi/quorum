/**
 * Route protection policy, expressed as pure data and pure predicates.
 *
 * Kept out of `middleware.ts` on purpose. The matcher is a security-relevant regular
 * expression — a mistake in it silently stops middleware running on a protected route,
 * and nothing else in the system would notice — but `middleware.ts` imports the Next
 * server runtime and cannot be unit tested. Separating the policy from the glue makes
 * the part that can be wrong the part that is covered.
 */

/** Routes that require a session. Everything else is public. */
export const PROTECTED_PREFIXES = [
  '/account',
  '/knowledge',
  '/runs',
  '/recipes',
  '/usage',
] as const;

/** Authentication pages stay reachable even when an existing session needs recovery. */
export const AUTH_ROUTES = ['/signin', '/verify-request'] as const;

/**
 * Skip static assets and the auth endpoints themselves. Running middleware over
 * `/api/auth/*` would wrap the sign-in handler in the very check it exists to satisfy.
 */
export const MIDDLEWARE_MATCHER =
  '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)';

export function requiresAuth(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isAuthRoute(pathname: string): boolean {
  return (AUTH_ROUTES as readonly string[]).includes(pathname);
}

/**
 * Only same-origin relative paths are accepted, so a crafted `callbackUrl` cannot bounce
 * a freshly-authenticated user to an attacker-controlled origin. Protocol-relative URLs
 * (`//evil.com`) look relative and are not, which is the case this exists to catch.
 */
export function safeCallbackUrl(raw: string | null | undefined, fallback = '/account'): string {
  if (!raw) return fallback;
  if (!raw.startsWith('/')) return fallback;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}
