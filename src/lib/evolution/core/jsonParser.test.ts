// Unit tests for shared JSON extraction utility.

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

  it('returns null when greedy match spans multiple invalid objects', () => {
    // Greedy regex spans '{"a":1} {"b":2}' which isn't valid JSON
    expect(extractJSON('{"a":1} {"b":2}')).toBeNull();
  });

  it('handles nested objects', () => {
    const result = extractJSON<{ outer: { inner: number } }>('Result: {"outer":{"inner":5}}');
    expect(result).toEqual({ outer: { inner: 5 } });
  });
});
