import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe half of the auth configuration.
 *
 * Next.js middleware runs on the edge runtime, where Prisma and nodemailer cannot load.
 * Splitting the config means middleware can read and verify the session cookie without
 * dragging a database driver into the edge bundle — the standard Auth.js pattern, and
 * the reason `providers` is empty here: middleware never initiates a sign-in.
 */
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/signin',
    verifyRequest: '/verify-request',
    error: '/auth-error',
  },
  providers: [],
  callbacks: {
    /** Used by middleware. Route-level rules live in `src/middleware.ts`. */
    authorized({ auth }) {
      return Boolean(auth?.user);
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
