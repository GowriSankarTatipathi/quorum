import { cn } from '@quorum/ui';
import { confidenceToPips } from '@/lib/format';

/**
 * Five discrete pips, not a percentage.
 *
 * `0.87` implies two significant figures we do not have. Five buckets communicate the
 * distinction the user is actually acting on — should I check this? — and the exact value
 * is available on hover for anyone who wants it.
 */
export function ConfidencePips({ confidence }: { confidence: number }) {
  const filled = confidenceToPips(confidence);
  const label = `Confidence ${confidence.toFixed(2)} of 1`;

  return (
    <span className="inline-flex items-center gap-0.5" title={label} aria-label={label} role="img">
      {[1, 2, 3, 4, 5].map((pip) => (
        <span
          key={pip}
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            pip <= filled
              ? filled >= 4
                ? 'bg-[var(--color-verified)]'
                : 'bg-[var(--color-review)]'
              : 'bg-[var(--color-hairline)]',
          )}
        />
      ))}
      <span className="ml-1 font-mono text-[10px] tabular-nums text-fg-subtle">
        {confidence.toFixed(2)}
      </span>
    </span>
  );
}
