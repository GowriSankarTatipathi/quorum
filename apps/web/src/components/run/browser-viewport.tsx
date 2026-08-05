'use client';

import { Button, cn } from '@quorum/ui';
import { Globe, Hand, Monitor } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRunStore } from '@/stores/run-store';
import { EmptyState } from './empty-state';

/**
 * The right half of the split screen.
 *
 * Left is intent, right is reality. The core trust question is whether what the agent says
 * it is doing matches what it is actually doing, and putting both on one screen answers it
 * continuously without the user having to ask. Any layout that requires a tab switch to
 * compare them destroys the value proposition.
 */
export function BrowserViewport({ onTakeover }: { onTakeover?: () => void }) {
  const frame = useRunStore((state) => state.frame);
  const highlight = useRunStore((state) => state.highlight);
  const pageUrl = useRunStore((state) => state.pageUrl);
  const liveViewUrl = useRunStore((state) => state.liveViewUrl);
  const browserSessionState = useRunStore((state) => state.browserSessionState);
  const connectionState = useRunStore((state) => state.connectionState);
  const disconnectCode = useRunStore((state) => state.disconnectCode);
  const humanQuestion = useRunStore((state) => state.humanQuestion);

  const takeover = humanQuestion !== null;

  return (
    <section
      aria-label="Live browser"
      className={cn(
        'flex min-h-0 flex-col rounded-[var(--radius-panel)] border transition-colors',
        takeover ? 'border-[var(--color-review)]' : 'border-hairline',
      )}
    >
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <Monitor className="size-3.5 text-fg-subtle" aria-hidden />
        <span className="truncate font-mono text-[11px] text-fg-muted">
          {pageUrl ?? 'no page yet'}
        </span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-fg-subtle">
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              connectionState === 'connected' && 'bg-[var(--color-verified)]',
              connectionState === 'connecting' && 'bg-[var(--color-review)]',
              (connectionState === 'disconnected' || connectionState === 'auth_failed') && 'bg-[var(--color-failed)]',
              connectionState === 'idle' && 'bg-fg-muted',
            )}
          />
          {connectionState === 'auth_failed' ? (
            <span className="text-failed">
              session expired (<Link href="/api/auth/signin" className="underline">sign in</Link>)
            </span>
          ) : connectionState === 'disconnected' ? (
            <span className="text-failed">
              disconnected {disconnectCode ? `(${disconnectCode})` : ''}
            </span>
          ) : connectionState === 'connected' ? (
            'live'
          ) : connectionState === 'connecting' ? (
            'connecting…'
          ) : (
            'idle'
          )}
        </span>
      </header>

      {takeover && (
        <div
          role="alert"
          className="border-b border-[var(--color-review)]/40 bg-[var(--color-review)]/10 px-3 py-2 text-xs text-review"
        >
          <strong className="font-medium">Takeover requested</strong> — {humanQuestion}
        </div>
      )}

      <div
        className={cn(
          'relative min-h-0 flex-1 overflow-hidden bg-raised transition-[box-shadow] duration-300',
          takeover && 'shadow-[inset_0_0_0_2px_var(--color-review)]',
        )}
      >
        {liveViewUrl ? (
          <iframe
            src={liveViewUrl}
            title="Live browser session"
            className="size-full border-0"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : browserSessionState === 'open' && !frame ? (
          <div className="flex size-full items-center justify-center">
            <div className="size-4 animate-spin rounded-full border-2 border-fg-subtle border-t-transparent" />
          </div>
        ) : frame ? (
          <div className="relative size-full">
            <Image
              src={frame.url}
              alt="Current page"
              fill
              unoptimized
              className={cn(
                'object-contain transition-opacity duration-150',
                browserSessionState === 'closed' && 'opacity-50 grayscale',
              )}
            />
            {browserSessionState === 'closed' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded bg-canvas/80 px-2 py-1 text-xs font-medium text-fg-subtle backdrop-blur">
                  Session ended
                </span>
              </div>
            )}
            {highlight && browserSessionState === 'open' && (
              // Drawn before the click, not after: predicting intent is the precondition
              // for trusting an agent, and it is what makes the pause key useful.
              <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 size-full"
                viewBox="0 0 1280 800"
                preserveAspectRatio="xMidYMid meet"
              >
                <rect
                  x={highlight.x}
                  y={highlight.y}
                  width={highlight.width}
                  height={highlight.height}
                  fill="none"
                  stroke="var(--color-action)"
                  strokeWidth={2}
                  rx={4}
                />
              </svg>
            )}
          </div>
        ) : (
          <div className="flex size-full items-center justify-center">
            <EmptyState
              icon={<Globe className="size-4" aria-hidden />}
              title="The browser has not started"
              detail="Once you approve the plan, everything the agent sees appears here — and the element it is about to click is outlined before it clicks it."
            />
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-hairline px-3 py-2">
        <Button variant="ghost" size="sm" onClick={onTakeover} disabled={!onTakeover}>
          <Hand aria-hidden />
          {takeover ? 'Return control to AI' : 'Take over'}
        </Button>
        <span className="ml-auto font-mono text-[10px] text-fg-subtle">
          {liveViewUrl ? 'interactive session' : '2 fps screenshot stream'}
        </span>
      </footer>
    </section>
  );
}
