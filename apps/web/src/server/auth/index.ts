import 'server-only';
import { ACCESS_TOKEN_REFRESH_SKEW_S, shouldRefresh } from '@quorum/auth';
import { userRepository } from '@quorum/db';
import NextAuth from 'next-auth';
import type { NextAuthResult } from 'next-auth';
import Google from 'next-auth/providers/google';
import Nodemailer from 'next-auth/providers/nodemailer';
import { getServerEnv, isGoogleEnabled, isMagicLinkEnabled } from '@/env';
import { createQuorumAdapter } from './adapter';
import { authConfig } from './config';
import { sendVerificationRequest } from './email';
import { getSessionService } from './session-service';

function buildProviders() {
  const serverEnv = getServerEnv();
  return [
    ...(isGoogleEnabled()
      ? [
          Google({
            clientId: serverEnv.GOOGLE_CLIENT_ID!,
            clientSecret: serverEnv.GOOGLE_CLIENT_SECRET!,
            // Google is the only identity source we treat as pre-verified, and only
            // because it asserts email ownership. Everything else goes through a link.
            allowDangerousEmailAccountLinking: false,
          }),
        ]
      : []),
    ...(isMagicLinkEnabled()
      ? [
          Nodemailer({
            server: {
              host: serverEnv.EMAIL_SERVER_HOST!,
              port: serverEnv.EMAIL_SERVER_PORT!,
              ...(serverEnv.EMAIL_SERVER_USER && serverEnv.EMAIL_SERVER_PASSWORD
                ? {
                    auth: {
                      user: serverEnv.EMAIL_SERVER_USER,
                      pass: serverEnv.EMAIL_SERVER_PASSWORD,
                    },
                  }
                : {}),
            },
            from: serverEnv.EMAIL_FROM,
            maxAge: 15 * 60,
            async sendVerificationRequest({ identifier, url, provider }) {
              const host = new URL(url).host;
              await sendVerificationRequest({
                identifier,
                url,
                host,
                from: provider.from ?? serverEnv.EMAIL_FROM,
                smtp: {
                  host: serverEnv.EMAIL_SERVER_HOST!,
                  port: serverEnv.EMAIL_SERVER_PORT!,
                  ...(serverEnv.EMAIL_SERVER_USER && serverEnv.EMAIL_SERVER_PASSWORD
                    ? {
                        auth: {
                          user: serverEnv.EMAIL_SERVER_USER,
                          pass: serverEnv.EMAIL_SERVER_PASSWORD,
                        },
                      }
                    : {}),
                },
              });
            },
          }),
        ]
      : []),
  ];
}

/**
 * Auth.js is configured through a factory rather than a literal.
 *
 * `next build` imports every route module to collect page data. A literal config would
 * construct providers — and therefore read secrets — during that import, making the
 * build require credentials it has no use for. The factory runs per request instead.
 */
const result: NextAuthResult = NextAuth(() => ({
  ...authConfig,
  adapter: createQuorumAdapter(),
  secret: getServerEnv().AUTH_SECRET,
  providers: buildProviders(),
  callbacks: {
    ...authConfig.callbacks,

    /**
     * The JWT callback owns the API credential lifecycle.
     *
     * Three distinct moments, and conflating them is the usual source of bugs:
     *   1. Sign-in — mint a brand-new token family.
     *   2. Steady state — the access token is still fresh, so do nothing. This is the
     *      overwhelming majority of calls and must stay free of database work.
     *   3. Expiry approaching — rotate. The refresh token is single-use, so the result
     *      replaces both halves of the pair.
     *
     * A rotation failure sets `error` rather than throwing: throwing here would produce
     * an opaque Auth.js error page, whereas a flagged session lets the UI say what
     * happened and send the person to sign in.
     */
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        const pair = await getSessionService().startSession(user.id);
        return {
          ...token,
          userId: user.id,
          accessToken: pair.accessToken,
          accessTokenExpiresAt: pair.accessTokenExpiresAt,
          refreshToken: pair.refreshToken,
          familyId: pair.familyId,
          error: undefined,
        };
      }

      if (trigger === 'update') {
        // An explicit session.update() means authority may have changed, so force a
        // rotation to pick up the new claims rather than waiting out the TTL.
        token.accessTokenExpiresAt = 0;
      }

      const expiresAt =
        typeof token.accessTokenExpiresAt === 'number' ? token.accessTokenExpiresAt : 0;
      const refreshToken = typeof token.refreshToken === 'string' ? token.refreshToken : null;

      if (!refreshToken) return { ...token, error: 'RefreshTokenMissing' };
      if (!shouldRefresh(expiresAt, ACCESS_TOKEN_REFRESH_SKEW_S)) return token;

      try {
        const pair = await getSessionService().refresh(refreshToken);
        return {
          ...token,
          accessToken: pair.accessToken,
          accessTokenExpiresAt: pair.accessTokenExpiresAt,
          refreshToken: pair.refreshToken,
          familyId: pair.familyId,
          error: undefined,
        };
      } catch (error) {
        const code = (error as { code?: string }).code ?? 'RefreshFailed';
        return { ...token, accessToken: undefined, error: code };
      }
    },

    /**
     * Project the token onto the session.
     *
     * Role and approval authority are read from the database rather than copied out of
     * the cookie: a cookie is a cache the user controls, and a demotion must take effect
     * on the next page load, not on the next rotation.
     */
    async session({ session, token }) {
      const userId = typeof token.userId === 'string' ? token.userId : null;
      session.error = typeof token.error === 'string' ? token.error : undefined;
      session.accessToken = typeof token.accessToken === 'string' ? token.accessToken : undefined;
      session.familyId = typeof token.familyId === 'string' ? token.familyId : undefined;

      if (!userId) return session;

      const user = await userRepository.findByIdWithOrg(userId);
      if (!user) {
        session.error = 'UserNotFound';
        return session;
      }

      session.user = {
        ...session.user,
        id: user.id,
        orgId: user.orgId,
        email: user.email,
        name: user.name,
        image: user.image,
        role: user.role,
        approvalAuthority: user.approvalAuthority,
        maxApprovalTrustLevel: user.maxApprovalTrustLevel,
        orgMaxApprovalTrustLevel: user.org.maxApprovalTrustLevel,
      };
      return session;
    },

    /** A disabled account must not be able to start a session at all. */
    async signIn({ user }) {
      if (!user.id) return true;
      const existing = await userRepository.findById(user.id);
      if (existing?.disabledAt) return '/auth-error?error=AccountDisabled';
      return true;
    },
  },
  events: {
    async signIn({ user }) {
      if (user.id) await userRepository.markSignedIn(user.id);
    },
  },
}));

export const { handlers, signIn, signOut, auth } = result;
