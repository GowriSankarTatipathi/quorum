export default function RunsLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10">
      <div className="mb-6 h-5 w-24 animate-pulse rounded bg-[var(--color-hairline)]" />
      <div className="divide-y divide-[var(--color-hairline)] rounded-[var(--radius-panel)] border border-hairline">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <div
              className="h-3 flex-1 animate-pulse rounded bg-[var(--color-hairline)]"
              style={{ animationDelay: `${String(i * 90)}ms` }}
            />
            <div className="h-3 w-16 animate-pulse rounded bg-[var(--color-hairline)]" />
          </div>
        ))}
      </div>
    </div>
  );
}
