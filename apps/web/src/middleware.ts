import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/server/auth/config';
import { isAuthRoute, requiresAuth, safeCallbackUrl } from '@/server/auth/route-policy';

/**
 * Route protection.
 *
 * Middleware uses the edge-safe half of the auth config, so no database driver is pulled
 * into the edge bundle. It answers exactly one question — is there a valid session — and
 * deliberately does not evaluate roles: authority is enforced at the API, where it cannot
 * be bypassed by anyone able to craft an HTTP request. A middleware role check would be a
 * UX nicety mistaken for a security boundary.
 */
const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  const signedIn = Boolean(request.auth?.user);

  // The edge session only verifies the cookie; the server may reject its user or
  // refresh token. Keep sign-in reachable so a stale cookie cannot create an
  // account -> sign-in -> account loop or prevent a fresh sign-in.
  if (isAuthRoute(pathname)) return NextResponse.next();

  if (!requiresAuth(pathname) || signedIn) return NextResponse.next();

  // Preserve where they were going, so signing in resumes the original intent rather
  // than dumping them on a landing page.
  const signInUrl = new URL('/signin', request.nextUrl);
  signInUrl.searchParams.set('callbackUrl', safeCallbackUrl(`${pathname}${search}`));
  return NextResponse.redirect(signInUrl);
});

/**
 * The matcher must be a literal: Next statically analyses this export at build time and
 * cannot resolve an imported constant. The same pattern is exported as
 * `MIDDLEWARE_MATCHER` from `route-policy.ts` where it is unit tested, and a test
 * asserts the two are byte-identical so they cannot drift apart.
 */
export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)',
  ],
};
