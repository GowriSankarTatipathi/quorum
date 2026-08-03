'use client';

import { Button } from '@quorum/ui';
import { Loader2, Mail } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { startGoogleSignIn, startMagicLinkSignIn, type ActionResult } from '@/server/auth/actions';

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="md" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}
      {children}
    </Button>
  );
}

function GoogleButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="md" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : <GoogleMark />}
      Continue with Google
    </Button>
  );
}

export function SignInForm({
  callbackUrl,
  googleEnabled,
  magicLinkEnabled,
}: {
  callbackUrl: string;
  googleEnabled: boolean;
  magicLinkEnabled: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    startMagicLinkSignIn,
    null,
  );

  return (
    <div className="space-y-4">
      {googleEnabled && (
        <form
          action={async () => {
            await startGoogleSignIn(callbackUrl);
          }}
        >
          <GoogleButton />
        </form>
      )}

      {googleEnabled && magicLinkEnabled && (
        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-[var(--color-hairline)]" />
          <span className="text-xs text-fg-subtle">or</span>
          <span className="h-px flex-1 bg-[var(--color-hairline)]" />
        </div>
      )}

      {magicLinkEnabled && (
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-xs text-fg-muted">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="maya@chen-cpa.com"
              aria-describedby={state && !state.ok ? 'signin-error' : undefined}
              aria-invalid={state ? !state.ok : undefined}
              className="w-full rounded-[var(--radius-control)] border border-hairline bg-raised px-3 py-2 text-sm text-fg outline-none transition-colors focus:border-[var(--color-action)]/60 placeholder:text-fg-subtle"
            />
          </div>

          {state && !state.ok && (
            <p id="signin-error" role="alert" className="text-xs text-failed">
              {state.message}
            </p>
          )}

          <SubmitButton>Email me a sign-in link</SubmitButton>
        </form>
      )}

      {!googleEnabled && !magicLinkEnabled && (
        <p role="alert" className="text-sm text-review">
          No sign-in method is configured on this deployment. Set Google OAuth credentials or SMTP
          settings and restart.
        </p>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4h6.6c-.1 1.1-.9 2.8-2.5 3.9l3.8 3c2.3-2.1 3.6-5.2 3.6-8.7z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-3c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5l-3.9 3A12 12 0 0 0 12 24z"
      />
      <path fill="#FBBC05" d="M5.1 14.3a7.4 7.4 0 0 1 0-4.6l-4-3a12 12 0 0 0 0 10.6z" />
      <path
        fill="#EA4335"
        d="M12 4.8c2.3 0 3.8 1 4.7 1.8l3.4-3.3A12 12 0 0 0 1.2 6.7l3.9 3c1-2.9 3.7-4.9 6.9-4.9z"
      />
    </svg>
  );
}
