import type { ReactNode } from 'react';

/**
 * One empty state, used everywhere.
 *
 * Every empty state says what *will* appear here and, where there is one, offers the
 * action that fills it. "No data" tells a user they are somewhere useless; "results appear
 * here as each site is read" tells them the screen is working and what to wait for.
 */
export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="mb-1 flex size-9 items-center justify-center rounded-full border border-hairline bg-raised text-fg-subtle">
        {icon}
      </div>
      <p className="text-sm text-fg-muted">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-fg-subtle">{detail}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Shown only where the shape of what is coming is already known — a run's own history.
 * Using one where arrival time is unknown would be a lie told with animation.
 */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-4 py-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-hairline)]" />
          <div
            className="h-3 animate-pulse rounded bg-[var(--color-hairline)]"
            style={{
              width: `${String(40 + ((i * 17) % 45))}%`,
              animationDelay: `${String(i * 120)}ms`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
