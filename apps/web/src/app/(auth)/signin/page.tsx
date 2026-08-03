import type { Metadata } from 'next';
import { isGoogleEnabled, isMagicLinkEnabled } from '@/env';
import { safeCallbackUrl } from '@/server/auth/route-policy';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in — QUORUM' };
export const runtime = 'nodejs';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(
    typeof params.callbackUrl === 'string' ? params.callbackUrl : undefined,
  );

  return (
    <div>
      <h1 className="text-lg font-medium tracking-tight">Sign in to QUORUM</h1>
      <p className="mt-1.5 mb-7 text-sm text-fg-muted">
        Agents do the browsing. You keep the authority.
      </p>

      <SignInForm
        callbackUrl={callbackUrl}
        googleEnabled={isGoogleEnabled()}
        magicLinkEnabled={isMagicLinkEnabled()}
      />

      <p className="mt-7 text-xs leading-relaxed text-fg-subtle">
        Signing in creates a workspace you own. Nothing irreversible ever happens in a run without
        an explicit approval from someone authorised to give it.
      </p>
    </div>
  );
}
