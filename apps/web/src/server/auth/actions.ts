'use server';
import { refreshTokenRepository } from '@quorum/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth, signIn, signOut } from '@/server/auth';
import { safeCallbackUrl } from '@/server/auth/route-policy';
import { getSessionService } from '@/server/auth/session-service';

/** `FormData.get` returns `string | File`; treating a File as a string would silently
 *  produce "[object File]" instead of failing, so non-strings are rejected outright. */
function field(formData: FormData, name: string, fallback = ''): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value : fallback;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function startGoogleSignIn(callbackUrl: string): Promise<void> {
  await signIn('google', { redirectTo: callbackUrl });
}

export async function startMagicLinkSignIn(
  _previous: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = field(formData, 'email').trim().toLowerCase();
  const callbackUrl = safeCallbackUrl(field(formData, 'callbackUrl'));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'That does not look like an email address.' };
  }

  try {
    await signIn('nodemailer', { email, redirectTo: callbackUrl, redirect: false });
  } catch (error) {
    // Auth.js signals a successful redirect by throwing; rethrow so Next can handle it.
    if (isRedirectError(error)) throw error;
    return {
      ok: false,
      message: 'We could not send that email. Check the address, or try Google instead.',
    };
  }

  redirect(`/verify-request?email=${encodeURIComponent(email)}`);
}

export async function signOutCurrentSession(): Promise<void> {
  const session = await auth();
  if (session?.user.id && session.familyId) {
    await getSessionService().endSession(session.familyId, session.user.id);
  }
  await signOut({ redirectTo: '/' });
}

/**
 * Revoke one device. The session-management list is the only place a person can act on
 * "I signed in on a machine I no longer trust", so it revokes the family rather than
 * merely deleting a cookie the attacker never had.
 */
export async function revokeSession(familyId: string): Promise<ActionResult> {
  const session = await auth();
  if (!session?.user.id) return { ok: false, message: 'You are not signed in.' };

  const families = await refreshTokenRepository.listActiveFamilies(session.user.id);
  const owned = families.some((f) => f.familyId === familyId);
  // Ownership is re-checked server-side: the familyId arrives from the client, and a
  // caller must never be able to revoke a session belonging to someone else.
  if (!owned) return { ok: false, message: 'That session is no longer active.' };

  await getSessionService().endSession(familyId, session.user.id);

  if (session.familyId === familyId) {
    await signOut({ redirectTo: '/signin' });
    return { ok: true, message: 'Signed out.' };
  }

  revalidatePath('/account');
  return { ok: true, message: 'That session was signed out.' };
}

export async function revokeAllSessions(): Promise<void> {
  const session = await auth();
  if (session?.user.id) await getSessionService().endAllSessions(session.user.id);
  await signOut({ redirectTo: '/signin' });
}

/**
 * Auth.js and Next signal a successful redirect by throwing. Swallowing that in a
 * catch block turns a working sign-in into a silent no-op, so it is re-thrown.
 */
function isRedirectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false;
  const { digest } = error;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}
