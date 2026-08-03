'use client';

import { Button, cn } from '@quorum/ui';
import { Globe, Hand, Monitor } from 'lucide-react';
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
  const connected = useRunStore((state) => state.connected);
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
              connected ? 'bg-[var(--color-verified)]' : 'bg-[var(--color-failed)]',
            )}
          />
          {connected ? 'live' : 'reconnecting'}
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
        ) : frame ? (
          <div className="relative size-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- screenshot frames are
                streamed blobs from the run, not static assets Next can optimise. */}
            <img
              src={frame.url}
              alt="Current page"
              className="size-full object-contain transition-opacity duration-150"
            />
            {highlight && (
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
