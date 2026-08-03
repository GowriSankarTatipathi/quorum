import { describe, expect, it } from 'vitest';
import { extractJson } from './json.js';

describe('extractJson', () => {
  it('parses a clean object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('recovers JSON from a markdown fence, which models emit despite instructions', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('recovers an object wrapped in prose', () => {
    expect(extractJson('Here is the plan:\n{"a":1}\nHope that helps!')).toEqual({ a: 1 });
  });

  it('is not fooled by braces inside string literals', () => {
    const value = extractJson('prefix {"note":"use { and } carefully","a":1} suffix');
    expect(value).toEqual({ note: 'use { and } carefully', a: 1 });
  });

  it('handles escaped quotes inside strings', () => {
    expect(extractJson('{"note":"he said \\"hi\\"","a":1}')).toEqual({
      note: 'he said "hi"',
      a: 1,
    });
  });

  it('parses arrays as well as objects', () => {
    expect(extractJson('leading [1,2,3] trailing')).toEqual([1, 2, 3]);
  });

  it('throws on an empty response rather than returning undefined', () => {
    expect(() => extractJson('   ')).toThrow(/empty/i);
  });

  it('throws when there is no JSON at all, so it becomes a reported violation', () => {
    expect(() => extractJson('I cannot help with that.')).toThrow(/not valid JSON/);
  });

  it('throws on an unterminated object rather than guessing at the remainder', () => {
    expect(() => extractJson('{"a":1')).toThrow(/not valid JSON/);
  });
});
