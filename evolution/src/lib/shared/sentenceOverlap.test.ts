// Tests for the sentence-overlap helper used by the universal sentenceVerbatimRatio metric.
// Covers exact match, near-match (Levenshtein <= 2), edge cases, and the
// "empty parent → 1.0" degenerate case.

import { extractSentences, sentenceVerbatimOverlap } from './sentenceOverlap';

describe('extractSentences', () => {
  it('tokenizes on period+space (last sentence keeps trailing punctuation)', () => {
    expect(extractSentences('First sentence. Second sentence.')).toEqual([
      'first sentence',
      'second sentence.',
    ]);
  });

  it('tokenizes on ?+space and !+space', () => {
    expect(extractSentences('Are you there? Yes! Of course.')).toEqual([
      'are you there',
      'yes',
      'of course.',
    ]);
  });

  it('lowercases and collapses whitespace', () => {
    expect(extractSentences('Hello   World.  Bye  Now.')).toEqual([
      'hello world',
      'bye now.',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(extractSentences('')).toEqual([]);
  });

  it('drops empty fragments from trailing punctuation', () => {
    expect(extractSentences('One. Two.    ')).toEqual(['one', 'two']);
  });
});

describe('sentenceVerbatimOverlap', () => {
  it('returns 1.0 for identical text', () => {
    const text = 'First. Second. Third.';
    const result = sentenceVerbatimOverlap(text, text);
    expect(result.ratio).toBe(1.0);
    expect(result.intersectionCount).toBe(3);
    expect(result.parentSentenceCount).toBe(3);
  });

  it('returns 0.0 for fully disjoint text', () => {
    const result = sentenceVerbatimOverlap(
      'Apples are red. Oranges are orange.',
      'The sky is blue. Grass grows.',
    );
    expect(result.ratio).toBe(0);
    expect(result.intersectionCount).toBe(0);
  });

  it('counts partial overlap correctly (2 of 4 parent sentences survive)', () => {
    const parent = 'Alpha. Beta. Gamma. Delta.';
    const child = 'Alpha. New. Gamma. Other.';
    const result = sentenceVerbatimOverlap(parent, child);
    expect(result.intersectionCount).toBe(2);
    expect(result.ratio).toBe(0.5);
    expect(result.parentSentenceCount).toBe(4);
    expect(result.childSentenceCount).toBe(4);
  });

  it('treats single-character changes as near-match (Levenshtein <= 2)', () => {
    // "ate the apple" → "ate the apples" — distance 1, should still count as match.
    const parent = 'I ate the apple. The end.';
    const child = 'I ate the apples. The end.';
    const result = sentenceVerbatimOverlap(parent, child);
    expect(result.intersectionCount).toBe(2);
    expect(result.ratio).toBe(1.0);
  });

  it('treats 3+ character difference as non-match', () => {
    // "ate the apple" → "tasted the fruit" — distance much greater than 2.
    const parent = 'I ate the apple. The end.';
    const child = 'I tasted the fruit. The end.';
    const result = sentenceVerbatimOverlap(parent, child);
    // First sentence does NOT match; second does.
    expect(result.intersectionCount).toBe(1);
    expect(result.ratio).toBe(0.5);
  });

  it('returns 1.0 when parent has zero sentences (degenerate case)', () => {
    const result = sentenceVerbatimOverlap('', 'Some new text. More.');
    expect(result.ratio).toBe(1.0);
    expect(result.parentSentenceCount).toBe(0);
    expect(result.childSentenceCount).toBe(2);
  });

  it('handles single-sentence article', () => {
    expect(sentenceVerbatimOverlap('Just one sentence.', 'Just one sentence.').ratio).toBe(1.0);
    expect(sentenceVerbatimOverlap('Just one sentence.', 'Different sentence.').ratio).toBe(0);
  });

  it('clamps near-match correctly: distance exactly 2 matches', () => {
    // "the cat" → "the cats" → distance 1
    const parent = 'The cat sat on the mat.';
    const child = 'The cat sat on the mats.';
    expect(sentenceVerbatimOverlap(parent, child).ratio).toBe(1.0);
  });

  it('ratio is always in [0, 1]', () => {
    const cases = [
      ['', ''],
      ['One.', 'One.'],
      ['One. Two.', 'Three.'],
      ['One. Two. Three.', 'Four. Five. Six.'],
      ['Same.', 'Same.'],
    ];
    for (const [p, c] of cases) {
      const r = sentenceVerbatimOverlap(p!, c!).ratio;
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('property: identical non-empty text always yields ratio 1.0', () => {
    const samples = [
      'A.',
      'A. B.',
      'Hello there. General Kenobi! You are a bold one.',
      'One sentence with semi; colon. Another.',
    ];
    for (const s of samples) {
      expect(sentenceVerbatimOverlap(s, s).ratio).toBe(1.0);
    }
  });
});
