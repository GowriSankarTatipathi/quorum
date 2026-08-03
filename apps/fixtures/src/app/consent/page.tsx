'use client';

import { useState } from 'react';

/** A consent overlay that intercepts every click until it is dismissed — the failure
 *  the Browser agent must detect rather than clicking through repeatedly. */
export default function FixtureConsent() {
  const [dismissed, setDismissed] = useState(false);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Vendor directory</h1>
      <p className="mt-2 text-sm text-neutral-600">
        {dismissed
          ? 'Acme Ledger — 120 employees — founded 2021 — headquarters Austin, TX.'
          : 'Content is behind the consent dialog.'}
      </p>

      {!dismissed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cookie consent"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-6"
        >
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="font-medium">We value your privacy</h2>
            <p className="mt-2 text-sm text-neutral-600">
              We and 812 partners store and access information on your device.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
              >
                Reject all
              </button>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white"
              >
                Accept all
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
