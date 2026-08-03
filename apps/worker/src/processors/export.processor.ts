import { buildExportBundle, buildWorkbook, toCsv } from '@quorum/export';
import { MIME_TYPES, artifactKeys } from '@quorum/storage';
import {
  artifactRepository,
  claimRepository,
  critiqueRepository,
  runRepository,
  type ArtifactKind,
  type VerdictRecord,
} from '@quorum/db';
import type { Job } from 'bullmq';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { eventPublisher } from '../services/event-publisher.js';
import { getStorage } from '../services/storage.js';

export type ExportFormat = 'xlsx' | 'csv' | 'json';

export interface ExportJobData {
  runId: string;
  format: ExportFormat;
  requestedBy: string;
}

const KIND: Record<ExportFormat, ArtifactKind> = {
  xlsx: 'EXPORT_XLSX',
  csv: 'EXPORT_CSV',
  json: 'EXPORT_JSON',
};

/**
 * Produce the deliverable.
 *
 * Runs in the worker rather than in the request: a workbook for a large run takes seconds
 * to assemble, and holding an HTTP connection open for it would tie up a gateway thread
 * for something the user is happy to wait on asynchronously.
 */
export async function processExport(job: Job<ExportJobData>): Promise<void> {
  const { runId, format } = job.data;
  await eventPublisher.resume(runId);

  const run = await runRepository.findById(runId);
  if (!run) {
    logger.warn({ runId }, 'export requested for a run that no longer exists');
    return;
  }

  const [claims, critiques] = await Promise.all([
    claimRepository.listForRun(runId),
    critiqueRepository.listForRun(runId),
  ]);

  // Verdicts are fetched per claim rather than joined, because most claims have none —
  // verification is sampled — and a join would pull the whole table to find a minority.
  const verdictsByClaim = new Map<string, VerdictRecord[]>();
  for (const claim of claims) {
    const verdicts = await claimRepository.listVerdicts(claim.id);
    if (verdicts.length > 0) verdictsByClaim.set(claim.id, verdicts);
  }

  const bundle = buildExportBundle({
    claims,
    verdictsByClaim,
    critiques,
    artifactBaseUrl: env.ARTIFACT_BASE_URL,
  });

  const generatedAt = Date.now();
  let body: Buffer;

  if (format === 'xlsx') {
    body = await buildWorkbook(bundle, {
      runId,
      goal: run.goal,
      startedAt: run.startedAt?.toISOString() ?? null,
      endedAt: run.endedAt?.toISOString() ?? null,
      spentUsd: run.spentMicroUsd / 1_000_000,
      mode: run.mode,
    });
  } else if (format === 'csv') {
    // Both sheets in one file, separated by a labelled blank line: a CSV cannot carry
    // tabs, and shipping the results without their provenance would defeat the point.
    body = Buffer.from(
      ['# RESULTS', toCsv(bundle.results), '', '# PROVENANCE', toCsv(bundle.provenance)].join('\n'),
      'utf8',
    );
  } else {
    body = Buffer.from(
      JSON.stringify({ run: { id: runId, goal: run.goal, mode: run.mode }, ...bundle }, null, 2),
      'utf8',
    );
  }

  const key = artifactKeys.export(runId, format, generatedAt);
  const stored = await getStorage().put(
    key,
    body,
    MIME_TYPES[format] ?? 'application/octet-stream',
  );

  await artifactRepository.record({
    runId,
    kind: KIND[format],
    r2Key: stored.key,
    mime: MIME_TYPES[format] ?? 'application/octet-stream',
    bytes: stored.bytes,
  });

  logger.info(
    {
      runId,
      format,
      bytes: stored.bytes,
      exported: bundle.summary.exported,
      excluded: bundle.summary.excluded,
    },
    'export ready',
  );

  eventPublisher.release(runId);
}
