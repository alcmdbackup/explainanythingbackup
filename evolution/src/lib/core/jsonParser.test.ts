// Unit tests for shared JSON extraction utility.
// Tests balanced-brace parser that handles nested objects, multiple objects, and string escapes.

import { extractJSON } from './jsonParser';

describe('extractJSON', () => {
  it('extracts JSON object from clean response', () => {
    const result = extractJSON<{ name: string }>('{"name":"test"}');
    expect(result).toEqual({ name: 'test' });
  });

  it('extracts JSON wrapped in prose', () => {
    const result = extractJSON<{ score: number }>('Here is the result: {"score": 42} done.');
    expect(result).toEqual({ score: 42 });
  });

  it('extracts JSON from markdown code fences', () => {
    const response = '```json\n{"scores":{"clarity":8}}\n```';
    const result = extractJSON<{ scores: { clarity: number } }>(response);
    expect(result).toEqual({ scores: { clarity: 8 } });
  });

  it('returns null for response with no JSON', () => {
    expect(extractJSON('No JSON here')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(extractJSON('{broken json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractJSON('')).toBeNull();
  });

  it('handles nested objects', () => {
    const result = extractJSON<{ outer: { inner: number } }>('Result: {"outer":{"inner":5}}');
    expect(result).toEqual({ outer: { inner: 5 } });
  });

  // ─── PARSE-1: Balanced-brace parser tests ──────────────────────

  it('extracts first valid object when multiple objects present', () => {
    // Previously: greedy regex matched '{"a":1} and {"b":2}' → JSON.parse fails
    const result = extractJSON<{ a: number }>('Result: {"a":1} and {"b":2}');
    expect(result).toEqual({ a: 1 });
  });

  it('handles deeply nested braces correctly', () => {
    const result = extractJSON<{ a: { b: { c: number } } }>('{"a":{"b":{"c":1}}}');
    expect(result).toEqual({ a: { b: { c: 1 } } });
  });

  it('handles braces inside string values', () => {
    const result = extractJSON<{ text: string }>('{"text":"hello {world}"}');
    expect(result).toEqual({ text: 'hello {world}' });
  });

  it('handles escaped quotes inside strings', () => {
    const result = extractJSON<{ text: string }>('{"text":"he said \\"hello\\""}');
    expect(result).toEqual({ text: 'he said "hello"' });
  });

  it('skips invalid first object and extracts valid second', () => {
    // First balanced block {not json} is invalid, parser should try next
    const result = extractJSON<{ ok: boolean }>('{not json} {"ok":true}');
    expect(result).toEqual({ ok: true });
  });

  it('returns null for unclosed brace', () => {
    expect(extractJSON('{"a": 1')).toBeNull();
  });

  it('extracts object adjacent to other objects without space', () => {
    const result = extractJSON<{ x: number }>('{"x":1}{"y":2}');
    expect(result).toEqual({ x: 1 });
  });
});
