/**
 * Shown while the run page's server component fetches.
 *
 * It mirrors the real layout rather than showing a spinner, so the screen does not jump
 * when data arrives — the frame is already in the right place and only the content
 * changes.
 */
export default function RunLoading() {
  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <header className="flex h-[3.25rem] shrink-0 items-center gap-4 border-b border-hairline px-5">
        <div className="h-3 w-72 animate-pulse rounded bg-[var(--color-hairline)]" />
        <div className="ml-auto h-3 w-40 animate-pulse rounded bg-[var(--color-hairline)]" />
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[55%_45%]">
        <div className="space-y-3 border-r border-hairline p-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-[var(--radius-panel)] bg-[var(--color-hairline)]"
              style={{ animationDelay: `${String(i * 120)}ms` }}
            />
          ))}
        </div>
        <div className="p-3">
          <div className="h-full animate-pulse rounded-[var(--radius-panel)] bg-[var(--color-hairline)]" />
        </div>
      </div>
    </div>
  );
}
