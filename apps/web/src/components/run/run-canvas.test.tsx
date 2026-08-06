import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RunCanvas } from './run-canvas';

vi.mock('@/server/runs/actions', () => ({
  controlRun: vi.fn(),
  getExportUrl: vi.fn(),
  requestExport: vi.fn(),
}));

describe('RunCanvas SSR', () => {
  it('renders elapsed time as 0:00 on the server to prevent hydration mismatch', () => {
    const markup = renderToString(
      <RunCanvas
        runId="run_123"
        accessToken="dummy"
        initialStatus="EXECUTING"
        initialSteps={[]}
        planHash="hash"
        goal="Test goal"
        startedAt={new Date('2026-08-04T12:00:00Z').toISOString()}
      />,
    );
    expect(markup).toContain('<span>0:00</span>');
  });
});
