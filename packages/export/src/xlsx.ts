import ExcelJS from 'exceljs';
import type { ExportBundle } from './rows.js';

export interface WorkbookMeta {
  runId: string;
  goal: string;
  startedAt: string | null;
  endedAt: string | null;
  spentUsd: number;
  mode: string;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF131315' },
};

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFAFAFA' }, size: 10 };
  header.fill = HEADER_FILL;
  header.height = 20;
  sheet.views = [{ state: 'frozen', ySplit: 1, showGridLines: false }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    let lines = 1;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF243247' } };
      cell.alignment = { wrapText: true, vertical: 'top' };
      const width = sheet.getColumn(column).width ?? 20;
      lines = Math.max(
        lines,
        ...cell.text.split('\n').map((line) => Math.ceil(line.length / Math.max(8, width - 3))),
      );
      if (index % 2 === 0)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F5F9' } };
    });
    row.height = Math.max(28, lines * 15 + 10);
  });
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  sheet.pageSetup.printTitlesRow = '1:1';
}

/**
 * The deliverable.
 *
 * Three sheets, and the second is the reason the feature exists. Provenance ships inside
 * the workbook rather than as a separate log, because the question — "where did this
 * number come from?" — arrives weeks later, in a meeting, without our application open. If
 * the answer only lives in our product, we have not actually solved the customer's
 * problem.
 */
export async function buildWorkbook(bundle: ExportBundle, meta: WorkbookMeta): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QUORUM';
  workbook.created = new Date();

  // A compact pricing view keeps the original claim-level evidence intact below.
  if (bundle.results.some((row) => row.field === 'price_display_text')) {
    const summary = workbook.addWorksheet('Pricing summary');
    summary.columns = [
      { header: 'Plan', key: 'entity', width: 20 },
      { header: 'Displayed price', key: 'price', width: 20 },
      { header: 'Billing selection', key: 'billing', width: 20 },
      { header: 'Seat basis', key: 'seats', width: 24 },
      { header: 'Features', key: 'features', width: 38 },
      { header: 'Review notes', key: 'review', width: 55 },
    ];
    const entities = [
      ...new Set(
        bundle.results.filter((row) => row.field === 'plan_name').map((row) => row.entity),
      ),
    ];
    for (const entity of entities) {
      const claims = bundle.results.filter((row) => row.entity === entity);
      const display = (field: string): string => {
        const matches = claims.filter((row) => row.field === field);
        if (!matches.length) return 'Not extracted';
        return matches
          .map(
            (row) =>
              `${row.value === 'not_present' ? 'Not stated on source' : row.value}${row.unit ? ` ${row.unit}` : ''}${row.status === 'VERIFIED' || row.status === 'HUMAN_CORRECTED' ? '' : ` [${row.status.toLowerCase()}]`}`,
          )
          .join('\n');
      };
      summary.addRow({
        entity,
        price: display('price_display_text'),
        billing: display('billing_period_confirmed'),
        seats: display('seat_basis'),
        features: display('features'),
        review:
          [
            ...new Set([
              ...claims
                .filter((row) => row.needsReview || row.status === 'AMBIGUOUS')
                .map((row) => `${row.field.replaceAll('_', ' ')}: ${row.status.toLowerCase()}`),
              ...(!claims.some((row) => row.field === 'features')
                ? ['Features were not extracted. See Findings.']
                : []),
            ]),
          ].join('\n') || 'See Results and Provenance for claim details.',
      });
    }
    styleHeader(summary);
  }

  // ── Results ───────────────────────────────────────────────────────────────
  const results = workbook.addWorksheet('Results');
  results.columns = [
    { header: 'Entity', key: 'entity', width: 22 },
    { header: 'Field', key: 'field', width: 32 },
    { header: 'Value', key: 'value', width: 18 },
    { header: 'Unit', key: 'unit', width: 26 },
    { header: 'Confidence', key: 'confidence', width: 12 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Note', key: 'note', width: 52 },
  ];
  const sortedResults = [...bundle.results].sort(
    (a, b) => a.entity.localeCompare(b.entity) || a.field.localeCompare(b.field),
  );
  for (const row of sortedResults) {
    results.addRow({
      ...row,
      field: row.field.replaceAll('_', ' '),
      value: row.value === 'not_present' ? 'Not stated on source' : row.value,
      status: row.status.toLowerCase().replaceAll('_', ' '),
    });
  }
  styleHeader(results);
  results.getColumn('confidence').numFmt = '0%';

  // Reserve visual emphasis for rows that genuinely need a human rather than
  // scanning all of them equally or throwing vague warnings.
  results.eachRow((row, index) => {
    if (index === 1) return;
    const confidenceCell = row.getCell('confidence');
    if (confidenceCell.value === null) {
      confidenceCell.value = 'not reported';
      confidenceCell.numFmt = '';
    }

    const resultData = sortedResults[index - 2];
    if (resultData?.needsReview) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF4CC' },
        };
      });
    }
  });

  // ── Provenance ────────────────────────────────────────────────────────────
  const provenance = workbook.addWorksheet('Provenance');
  provenance.columns = [
    { header: 'Entity', key: 'entity', width: 22 },
    { header: 'Field', key: 'field', width: 32 },
    { header: 'Value', key: 'value', width: 16 },
    { header: 'Source URL', key: 'sourceUrl', width: 46 },
    { header: 'Text read from the page', key: 'sourceText', width: 40 },
    { header: 'Extracted at', key: 'extractedAt', width: 22 },
    { header: 'Model', key: 'extractedBy', width: 22 },
    { header: 'Prompt version', key: 'promptVersion', width: 18 },
    { header: 'Confidence', key: 'confidence', width: 12 },
    { header: 'Verification', key: 'verificationStatus', width: 16 },
    { header: 'Independent reading', key: 'independentReading', width: 20 },
    { header: 'Screenshot', key: 'screenshot', width: 44 },
    { header: 'Claim id', key: 'claimId', width: 28 },
    { header: 'Corrected by', key: 'correctedBy', width: 24 },
  ];
  for (const row of bundle.provenance) {
    const added = provenance.addRow(row);
    if (row.screenshot.length > 0) {
      const cell = added.getCell('screenshot');
      cell.value = { text: 'view screenshot', hyperlink: row.screenshot };
      cell.font = { color: { argb: 'FF3B6FD4' }, underline: true };
    }
    if (row.sourceUrl.length > 0) {
      const cell = added.getCell('sourceUrl');
      cell.value = { text: row.sourceUrl, hyperlink: row.sourceUrl };
      cell.font = { color: { argb: 'FF3B6FD4' }, underline: true };
    }
  }
  styleHeader(provenance);
  provenance.eachRow((row, index) => {
    if (index === 1) return;
    const confidenceCell = row.getCell('confidence');
    if (confidenceCell.value === null) {
      confidenceCell.value = 'not reported';
      confidenceCell.numFmt = '';
    } else {
      confidenceCell.numFmt = '0%';
    }
  });

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings = workbook.addWorksheet('Findings');
  findings.columns = [
    { header: 'Severity', key: 'severity', width: 12 },
    { header: 'Kind', key: 'kind', width: 24 },
    { header: 'Finding', key: 'message', width: 80 },
    { header: 'Claims', key: 'claimIds', width: 40 },
    { header: 'Resolution', key: 'resolution', width: 14 },
  ];
  for (const critique of bundle.critiques) {
    findings.addRow({
      severity: critique.severity,
      kind: critique.kind,
      message: critique.message,
      claimIds: critique.claimIds.join(', '),
      resolution: critique.resolution,
    });
  }
  styleHeader(findings);

  // ── About ─────────────────────────────────────────────────────────────────
  const about = workbook.addWorksheet('About this export');
  about.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 90 },
  ];
  const rows: [string, string][] = [
    ['Goal', meta.goal],
    ['Run id', meta.runId],
    ['Autonomy mode', meta.mode],
    ['Started', meta.startedAt ?? 'unknown'],
    ['Finished', meta.endedAt ?? 'unknown'],
    ['Cost', `$${meta.spentUsd.toFixed(4)}`],
    ['Values exported', String(bundle.summary.exported)],
    ['Values excluded', String(bundle.summary.excluded)],
    ['Verified', String(bundle.summary.verified)],
    ['Corrected by a person', String(bundle.summary.humanCorrected)],
    ['Mean confidence', bundle.summary.meanConfidence.toFixed(3)],
    ['Blocking findings', String(bundle.summary.blockingCritiques)],
    [
      'How to read this',
      'Every value on the Results sheet has a row on the Provenance sheet giving the page it came from, the exact text it was read from, and a screenshot. Quarantined values are excluded and counted above. Uncertain or disputed values may remain with review flags. Confidence is the extractor score, not a guarantee of correctness. Check Findings for missing requested fields.',
    ],
  ];
  for (const [field, value] of rows) about.addRow({ field, value });
  styleHeader(about);
  about.getColumn('value').alignment = { wrapText: true, vertical: 'top' };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
