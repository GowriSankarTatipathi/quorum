import { describe, expect, it } from 'vitest';
import { escapeCsvCell, toCsv } from './csv.js';

describe('escapeCsvCell', () => {
  it('leaves ordinary values alone', () => {
    expect(escapeCsvCell('Ramp')).toBe('Ramp');
    expect(escapeCsvCell(15)).toBe('15');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsvCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('quotes values containing commas or newlines', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });

  it('neutralises formula injection from scraped page content', () => {
    // Values come from third-party pages. Without this, a hostile page ships a live
    // formula into an accountant's spreadsheet.
    expect(escapeCsvCell('=HYPERLINK("http://evil","click")')).toBe(
      `"'=HYPERLINK(""http://evil"",""click"")"`,
    );
    expect(escapeCsvCell('+1234')).toBe(`'+1234`);
    expect(escapeCsvCell('@SUM(A1)')).toBe(`'@SUM(A1)`);
  });

  it('neutralises a leading minus in a STRING but never in a number', () => {
    // A scraped string could be a formula; a negative number is a credit, and prefixing it
    // would corrupt exactly the data an accountant cares about.
    expect(escapeCsvCell('-2+3')).toBe(`'-2+3`);
    expect(escapeCsvCell(-500)).toBe('-500');
    expect(escapeCsvCell(-0.25)).toBe('-0.25');
  });

  it('renders null and undefined as empty rather than the words', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('writes a header row and one row per record', () => {
    const csv = toCsv([
      { entity: 'Ramp', value: 15 },
      { entity: 'Brex', value: 12 },
    ]);
    expect(csv).toBe('entity,value\nRamp,15\nBrex,12\n');
  });

  it('honours an explicit column order and includes missing keys as empty', () => {
    const csv = toCsv([{ b: 2 }], ['a', 'b']);
    expect(csv).toBe('a,b\n,2\n');
  });

  it('emits headers even with no rows, so the file is still readable', () => {
    expect(toCsv([], ['entity', 'value'])).toBe('entity,value\n');
  });
});
