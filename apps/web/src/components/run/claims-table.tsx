'use client';

import { cn } from '@quorum/ui';
import { AlertTriangle, ExternalLink, Table2 } from 'lucide-react';
import { claimDisposition } from '@quorum/core';
import { useRunStore } from '@/stores/run-store';
import { ConfidencePips } from './confidence-pips';
import { EmptyState } from './empty-state';

const STATUS_STYLE: Record<string, string> = {
  VERIFIED: 'text-verified',
  UNVERIFIED: 'text-fg-subtle',
  CONTRADICTED: 'text-failed',
  AMBIGUOUS: 'text-review',
  UNSUPPORTED: 'text-review',
  SUPERSEDED: 'text-fg-subtle line-through',
  QUARANTINED: 'text-failed font-medium',
};

/**
 * Results fill in live.
 *
 * Value accrues continuously rather than at the end: stop the run at 60% and you keep 60%
 * of the value. It also removes the "did it freeze?" anxiety that kills long-running agent
 * interfaces — something visible is always arriving.
 */
export function ClaimsTable() {
  const claims = useRunStore((state) => state.claims);
  const critiques = useRunStore((state) => state.critiques);
  const rows = [...claims.values()];

  const flaggedIds = new Set(critiques.flatMap((critique) => critique.claimIds));

  return (
    <section aria-label="Results" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Results</h2>
        <span className="ml-auto font-mono text-[11px] text-fg-subtle">
          {rows.length > 5
            ? `${rows.length} claims (scroll to view all)`
            : `${rows.length} ${rows.length === 1 ? 'claim' : 'claims'}`}
        </span>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Table2 className="size-4" aria-hidden />}
          title="No values extracted yet"
          detail="Each value appears the moment it is read, with the page it came from. Stopping early keeps everything found so far."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-fg-muted/20">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-base">
              <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-fg-subtle">
                <th scope="col" className="px-3 py-1.5 font-normal">
                  Entity
                </th>
                <th scope="col" className="px-3 py-1.5 font-normal">
                  Field
                </th>
                <th scope="col" className="px-3 py-1.5 font-normal">
                  Value
                </th>
                <th scope="col" className="px-3 py-1.5 font-normal">
                  Status
                </th>
                <th scope="col" className="px-3 py-1.5 font-normal">
                  Confidence
                </th>
                <th scope="col" className="px-3 py-1.5 font-normal">
                  Source
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-hairline)]">
              {rows.map((claim) => {
                // Determine disposition for the claim
                const disposition = claimDisposition({
                  confidence: claim.confidence,
                  status: claim.status,
                  // In the table, we assume grounded because ungrounded are not stored
                  grounded: true,
                  verdicts:
                    claim.status === 'CONTRADICTED' ? [{ verdict: 'CONTRADICTED' as const }] : [],
                });

                const isQuarantined = disposition === 'QUARANTINE';

                return (
                  <tr key={claim.id} className="animate-[stream-in_150ms_cubic-bezier(0.2,0,0,1)]">
                    <td className="px-3 py-1.5">{claim.entity}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-fg-muted">
                      {claim.field}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-1.5 font-mono tabular-nums',
                        STATUS_STYLE[claim.status],
                      )}
                    >
                      <div className={cn(isQuarantined && 'line-through opacity-50')}>
                        {claim.value === null ? (
                          <span className="italic text-fg-subtle">null</span>
                        ) : (
                          renderValue(claim.value)
                        )}
                        {claim.unit && (
                          <span className="ml-1 text-[10px] text-fg-subtle">{claim.unit}</span>
                        )}
                      </div>
                      {flaggedIds.has(claim.id) && (
                        <AlertTriangle
                          className="ml-1.5 inline size-3 text-review"
                          aria-label="Flagged by the Critic"
                        />
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={cn(
                            'uppercase',
                            STATUS_STYLE[isQuarantined ? 'QUARANTINED' : claim.status] ??
                              'text-fg-subtle',
                          )}
                        >
                          {isQuarantined ? 'QUARANTINED' : claim.status}
                        </span>
                        {disposition !== 'ACCEPT' && !isQuarantined && (
                          <span className="text-[10px] text-fg-muted uppercase">
                            {disposition.replace('_', ' ')}
                          </span>
                        )}
                        {['CONTRADICTED', 'AMBIGUOUS', 'UNSUPPORTED'].includes(claim.status) &&
                          claim.independentReading !== undefined && (
                            <details className="mt-1 group">
                              <summary className="cursor-pointer text-[10px] text-failed hover:underline outline-none">
                                View reading
                              </summary>
                              <div className="mt-1 rounded bg-canvas/50 p-1.5 text-fg-muted">
                                Verifier read:{' '}
                                <span className="font-medium text-fg">
                                  {renderValue(claim.independentReading)}
                                </span>
                              </div>
                            </details>
                          )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <ConfidencePips confidence={claim.confidence} />
                    </td>
                    <td className="px-3 py-1.5">
                      {/* Provenance is one click away from every value, always. */}
                      <a
                        href={claim.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-fg-subtle hover:text-[var(--color-action)]"
                      >
                        {new URL(claim.sourceUrl).hostname.replace(/^www\./, '')}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Claim values are primitives or string arrays. Anything else would stringify to
 * "[object Object]" — a cell that looks like data and is not, which is precisely the kind
 * of quiet wrongness this product exists to avoid.
 */
function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(renderValue).join(', ');
  return JSON.stringify(value) ?? '—';
}
