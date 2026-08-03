/**
 * Object keys are structured so a prefix delete is a complete deletion.
 *
 * A GDPR erasure request must be one `DELETE FROM runs` plus one prefix delete in object
 * storage. Keys scattered by type rather than by tenant would make that a reconciliation
 * job, and a deletion that leaves orphans behind is a compliance problem rather than an
 * untidy bucket.
 */
export const artifactKeys = {
  screenshot: (runId: string, stepId: string, seq: number): string =>
    `orgs/runs/${runId}/steps/${stepId}/shots/${String(seq).padStart(4, '0')}.jpg`,

  domSnapshot: (runId: string, stepId: string, seq: number): string =>
    `orgs/runs/${runId}/steps/${stepId}/dom/${String(seq).padStart(4, '0')}.html`,

  export: (runId: string, format: string, at: number): string =>
    `orgs/runs/${runId}/exports/${String(at)}.${format}`,

  runPrefix: (runId: string): string => `orgs/runs/${runId}/`,
};

export const MIME_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  jpg: 'image/jpeg',
  html: 'text/html; charset=utf-8',
};

/** Filenames a person will recognise in their Downloads folder six weeks from now. */
export function downloadFilename(goal: string, format: string, at: Date): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const date = at.toISOString().slice(0, 10);
  return `quorum-${slug.length > 0 ? slug : 'run'}-${date}.${format}`;
}
