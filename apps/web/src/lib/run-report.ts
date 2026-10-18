export interface ReportClaim {
  id: string;
  entity: string;
  field: string;
  value: unknown;
  unit: string | null;
  status: string;
  confidence: number | null;
  sourceUrl: string;
  sourceText: string | null;
  capturedAt: string;
  nullReason: string | null;
  screenshotUrl: string | null;
  rationale: string | null;
  independentReading: unknown;
}
export interface RunReport {
  usage?: {
    spentUsd: number;
    budgetUsd: number;
    estimatedUsd: number | null;
    calls: number;
    agents: { agent: string; calls: number; spentUsd: number }[];
  };
  status: string;
  availability: { state: 'ready' | 'offline' | 'unknown'; workers: number };
  queuePosition: number | null;
  approvalQueued: boolean;
  lastActivityAt: string;
  finishedAt: string | null;
  outcome: 'incomplete' | 'review' | 'finished' | null;
  findings: { id: string; kind: string; severity: string; message: string; claimIds: string[] }[];
  skippedSteps: string[];
  evidenceWarnings: string[];
  claims: ReportClaim[];
}
export function reportTitle(report: RunReport): string {
  if (report.approvalQueued)
    return report.availability.state === 'offline'
      ? 'Approved · waiting for a worker'
      : 'Approved · queued for execution';
  if (report.status === 'CREATED')
    return report.availability.state === 'offline'
      ? 'Waiting for a worker'
      : report.availability.state === 'unknown'
        ? 'Task saved · availability unknown'
        : 'Queued for planning';
  if (report.outcome === 'incomplete') return 'Finished with missing data';
  if (report.outcome === 'review') return 'Finished · review needed';
  if (report.outcome === 'finished') return 'Finished · results ready to inspect';
  return (
    (
      {
        PLANNING: 'Creating your plan',
        AWAITING_APPROVAL: 'Your approval is needed',
        EXECUTING: 'Gathering evidence',
        VERIFYING: 'Checking the results',
        CRITIQUE: 'Reviewing coverage and consistency',
        PAUSED: 'Paused · review the findings',
        FAILED: 'Task stopped with an error',
        CANCELLED: 'Task cancelled',
        TAKEOVER: 'Your input is needed',
      } as Record<string, string>
    )[report.status] ?? report.status.toLowerCase().replaceAll('_', ' ')
  );
}
export function readableField(field: string): string {
  return field.replaceAll('_', ' ').replaceAll('.', ' · ');
}
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not stated';
  if (Array.isArray(value)) return value.map(displayValue).join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return 'Unavailable';
}
