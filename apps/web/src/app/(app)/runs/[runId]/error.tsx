'use client';

import { Button } from '@quorum/ui';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

/**
 * A run page that fails should not lose the run.
 *
 * The work is durable — claims, events and artifacts are already in the database — so the
 * copy says that explicitly. A generic "something went wrong" would leave the user
 * believing three minutes of browsing had evaporated.
 */
export default function RunError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('run page failed', error);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-5">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full border border-hairline bg-raised">
          <AlertTriangle className="size-4 text-review" aria-hidden />
        </div>
        <h1 className="text-sm font-medium">This run could not be loaded</h1>
        <p className="mt-2 text-xs leading-relaxed text-fg-muted">
          Nothing has been lost — everything the agents found is saved and will still be here. This
          is a problem displaying it.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[10px] text-fg-subtle">reference {error.digest}</p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/runs">All runs</Link>
          </Button>
          <Button variant="primary" size="sm" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
