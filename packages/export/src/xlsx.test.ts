import { expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook } from './xlsx.js';
import type { ExportBundle, ResultRow } from './rows.js';

it('keeps missing fields and uncertain values visible in the compact pricing export', async () => {
  const row = (field: string, value: string, status = 'VERIFIED'): ResultRow => ({
    entity: 'Enterprise',
    field,
    value,
    status,
    unit: '',
    confidence: 1,
    note: '',
    needsReview: status !== 'VERIFIED',
  });
  const bundle: ExportBundle = {
    results: [
      row('plan_name', 'Enterprise'),
      row('price_display_text', 'Custom'),
      row('seat_basis', 'not_present', 'AMBIGUOUS'),
    ],
    provenance: [],
    critiques: [],
    summary: {
      totalClaims: 3,
      exported: 3,
      excluded: 0,
      verified: 2,
      humanCorrected: 0,
      meanConfidence: 1,
      blockingCritiques: 0,
    },
  };
  const bytes = await buildWorkbook(bundle, {
    runId: 'test',
    goal: 'Pricing',
    startedAt: null,
    endedAt: null,
    spentUsd: 0,
    mode: 'supervised',
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(bytes).buffer);
  const summary = book.getWorksheet('Pricing summary')!;
  expect(summary.getCell('B2').text).toBe('Custom');
  expect(summary.getCell('D2').text).toContain('ambiguous');
  expect(summary.getCell('E2').text).toBe('Not extracted');
  expect(summary.getCell('F2').text).toContain('Features were not extracted');
  expect(summary.getCell('F2').alignment.wrapText).toBe(true);
  expect(book.getWorksheet('Results')!.rowCount).toBe(4);
  expect(book.getWorksheet('Provenance')).toBeDefined();
});
