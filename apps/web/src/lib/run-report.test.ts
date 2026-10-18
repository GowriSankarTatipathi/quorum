import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ResultsSummary } from '@/components/run/results-summary';
import { reportTitle, type RunReport } from './run-report';
const report: RunReport = {
  status: 'COMPLETED',
  availability: { state: 'ready', workers: 1 },
  queuePosition: null,
  approvalQueued: false,
  lastActivityAt: '2026-10-18T02:00:00Z',
  finishedAt: '2026-10-18T02:00:00Z',
  outcome: 'incomplete',
  findings: [
    {
      id: 'gap',
      kind: 'COVERAGE_GAP',
      severity: 'WARNING',
      message: 'Features were not extracted.',
      claimIds: [],
    },
  ],
  skippedSteps: [],
  evidenceWarnings: ['Four feature quotes did not match.'],
  claims: [],
};
describe('honest task outcomes', () => {
  it('does not describe missing requested data as success', () => {
    expect(reportTitle(report)).toBe('Finished with missing data');
  });
  it('distinguishes an offline worker from an unavailable status check', () => {
    expect(
      reportTitle({ ...report, status: 'CREATED', availability: { state: 'offline', workers: 0 } }),
    ).toBe('Waiting for a worker');
    expect(
      reportTitle({ ...report, status: 'CREATED', availability: { state: 'unknown', workers: 0 } }),
    ).toContain('unknown');
  });
  it('exposes coverage findings and evidence exclusions and only prepares a retry draft', () => {
    const html = renderToStaticMarkup(
      createElement(ResultsSummary, { report, goal: 'Extract pricing', runId: 'run1' }),
    );
    expect(html).toContain('Features were not extracted.');
    expect(html).toContain('Four feature quotes did not match.');
    expect(html).toContain('/runs/new?goal=');
    expect(html).toContain('Nothing runs until you submit');
  });
});
