'use client';
import Image from 'next/image';
import Link from 'next/link';
import type { ReportClaim, RunReport } from '@/lib/run-report';
import { displayValue, readableField, reportTitle } from '@/lib/run-report';

function Evidence({ claim }: { claim: ReportClaim }) {
  return (
    <details className="rounded-lg border border-hairline p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {readableField(claim.field)}: {displayValue(claim.value)} {claim.unit ?? ''}{' '}
        <span className="ml-2 text-fg-muted">
          ({claim.status.toLowerCase().replaceAll('_', ' ')})
        </span>
      </summary>
      <div className="mt-3 space-y-3 text-sm text-fg-muted">
        <a
          href={claim.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="block break-all text-fg underline"
        >
          Open source page
        </a>
        <p>
          Extracted: {new Date(claim.capturedAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC
        </p>
        <blockquote className="border-l-2 border-hairline pl-3 whitespace-pre-wrap">
          {claim.sourceText ?? 'No source quote was recorded for this absence.'}
        </blockquote>
        <p>{claim.rationale ?? 'No independent verification explanation was recorded.'}</p>
        {claim.independentReading !== null && (
          <p>Independent reading: {displayValue(claim.independentReading)}</p>
        )}
        <p>
          Extractor confidence:{' '}
          {claim.confidence === null ? 'Not reported' : `${Math.round(claim.confidence * 100)}%`}.
          This is a model estimate, not a guarantee.
        </p>
        {claim.screenshotUrl ? (
          <a href={claim.screenshotUrl} target="_blank" rel="noreferrer">
            <Image
              src={claim.screenshotUrl}
              alt={`Captured evidence for ${claim.entity}`}
              width={1280}
              height={800}
              unoptimized
              className="mt-2 h-auto w-full rounded border border-hairline"
            />
          </a>
        ) : (
          <p>
            No screenshot was linked to this claim. Older runs may only have a final browser view.
          </p>
        )}
      </div>
    </details>
  );
}
export function ResultsSummary({
  report,
  goal,
  runId,
}: {
  report: RunReport;
  goal: string;
  runId: string;
}) {
  const entities = [
    ...new Set(
      report.claims.filter((c) => c.entity !== 'verification_summary').map((c) => c.entity),
    ),
  ];
  const issues = report.findings.filter((f) => f.severity !== 'NOTE');
  const retryGoal = `${goal}\nFocus this follow-up on unresolved information only. ${issues.map((f) => f.message).join(' ')} ${report.skippedSteps.length ? `Skipped work: ${report.skippedSteps.join('; ')}` : ''} Gather fresh source evidence and identify anything still unavailable.`;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <section className="rounded-xl border border-hairline bg-raised p-5" aria-live="polite">
        <h1 className="text-xl font-semibold">{reportTitle(report)}</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {report.claims.length} current claims ·{' '}
          {
            report.claims.filter((c) => c.status === 'VERIFIED' || c.status === 'HUMAN_CORRECTED')
              .length
          }{' '}
          verified or corrected · {issues.length} open findings
        </p>
        <p className="mt-2 text-sm text-fg-muted">
          Last activity:{' '}
          {new Date(report.lastActivityAt).toLocaleString('en-US', { timeZone: 'UTC' })} UTC
          {report.queuePosition ? ` · Approximate queue position: ${report.queuePosition}` : ''}
        </p>
        {report.status === 'CREATED' && (
          <p className="mt-3 text-sm">
            {report.availability.state === 'offline'
              ? 'Your task is saved. No worker is connected, so no agent has started. Planning will begin when a worker reconnects. You can cancel using Stop.'
              : 'Your task is waiting for planning. You will be asked to approve the plan before browsing begins.'}
          </p>
        )}
        {report.availability.state === 'offline' &&
          !['CREATED', 'COMPLETED', 'CANCELLED', 'FAILED'].includes(report.status) && (
            <p className="mt-3 text-sm text-review">
              Worker disconnected. Progress may be delayed until it reconnects.
            </p>
          )}
        {report.status === 'COMPLETED' && (
          <p className="mt-3 text-sm">
            Execution has ended. Review missing information and evidence before using the result.
          </p>
        )}
      </section>
      {report.usage && (
        <details className="rounded-xl border border-hairline p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Model usage · {report.usage.calls} calls · ${report.usage.spentUsd.toFixed(4)} recorded
            cost
          </summary>
          <p className="mt-3 text-sm text-fg-muted">
            Run budget: ${report.usage.budgetUsd.toFixed(2)}.
            {report.usage.estimatedUsd !== null
              ? ` Planned steps estimate: $${report.usage.estimatedUsd.toFixed(4)}.`
              : ' No step cost estimate was recorded.'}{' '}
            Recorded model costs exclude infrastructure charges. Estimates are not guarantees.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {report.usage.agents.map((agent) => (
              <li key={agent.agent} className="flex flex-wrap justify-between gap-2">
                <span className="capitalize">{agent.agent}</span>
                <span>
                  {agent.calls} calls · ${agent.spentUsd.toFixed(4)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {report.evidenceWarnings.length > 0 && (
        <details className="rounded-xl border border-hairline p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Some claims were excluded · {report.evidenceWarnings.length} evidence warnings
          </summary>
          <p className="mt-3 text-sm text-fg-muted">
            Source quotes could not be matched, so these claims were excluded. Other supported
            results remain available.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {report.evidenceWarnings.map((message, i) => (
              <li key={i}>{message}</li>
            ))}
          </ul>
        </details>
      )}
      {(report.findings.length > 0 || report.skippedSteps.length > 0) && (
        <section className="rounded-xl border border-hairline p-5">
          <h2 className="text-[16px] font-semibold">Findings and missing information</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {issues.map((f) => (
              <li key={f.id}>
                <span className="font-medium">
                  {f.severity === 'NOTE' ? 'Note' : 'Needs review'}:{' '}
                </span>
                {f.message}
              </li>
            ))}
            {report.skippedSteps.map((step) => (
              <li key={step}>Skipped: {step}</li>
            ))}
          </ul>
          {report.findings.some((f) => f.severity === 'NOTE') && (
            <details className="mt-3 text-sm text-fg-muted">
              <summary className="cursor-pointer">Additional reviewer notes</summary>
              <ul className="mt-2 space-y-2">
                {report.findings
                  .filter((f) => f.severity === 'NOTE')
                  .map((f) => (
                    <li key={f.id}>{f.message}</li>
                  ))}
              </ul>
            </details>
          )}

          {['COMPLETED', 'FAILED', 'CANCELLED'].includes(report.status) && (
            <Link
              href={`/runs/new?goal=${encodeURIComponent(retryGoal)}`}
              className="mt-4 inline-flex min-h-11 items-center rounded-md bg-action px-4 py-2 text-sm font-medium text-white"
            >
              Prepare a focused retry
            </Link>
          )}
          <p className="mt-2 text-sm text-fg-muted">
            Retry opens an editable draft. Nothing runs until you submit it and approve its plan.
          </p>
        </section>
      )}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Results by entity</h2>
          <Link href={`/runs/${runId}/evidence`} className="text-sm underline">
            All saved screenshots
          </Link>
        </div>
        {!entities.length && (
          <p className="rounded-xl border border-hairline p-6 text-sm text-fg-muted">
            No results are available yet. The activity view shows planning, approvals, and agent
            progress.
          </p>
        )}
        <div className="space-y-4">
          {entities.map((entity) => {
            const claims = report.claims.filter((c) => c.entity === entity);
            const priority = ['price_display_text', 'monthly_price', 'price'];
            const price = priority
              .map((field) => claims.find((c) => c.field === field && c.value !== null))
              .find(Boolean);
            const visible = claims.filter(
              (c) =>
                c.field !== 'plan_name' &&
                !(price && priority.includes(c.field) && c.id !== price.id) &&
                !(c.field === 'seats' && claims.some((x) => x.field === 'seat_basis')),
            );
            return (
              <article key={entity} className="rounded-xl border border-hairline p-5">
                <h3 className="text-lg font-semibold">{entity}</h3>
                <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {visible.map((c) => (
                    <div key={c.id}>
                      <dt className="text-sm text-fg-muted">{readableField(c.field)}</dt>
                      <dd className="mt-1 text-[16px]">
                        {displayValue(c.value)} {c.unit ?? ''}
                      </dd>
                      {!['VERIFIED', 'HUMAN_CORRECTED'].includes(c.status) && (
                        <p className="mt-1 text-sm text-review">
                          {c.status.toLowerCase().replaceAll('_', ' ')} · inspect evidence
                        </p>
                      )}
                    </div>
                  ))}
                </dl>
                <details className="mt-4 border-t border-hairline pt-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Inspect source evidence and all {claims.length} claims
                  </summary>
                  <div className="mt-3 space-y-2">
                    {claims.map((c) => (
                      <Evidence key={c.id} claim={c} />
                    ))}
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
