// Tests for the trigram-Jaccard semantic-overlap helper used by the redundancy
// guardrail in validateEditGroups. Covers identical / disjoint cases, edge cases
// (empty / very short text), and the threshold-straddling case.

import { extractTrigrams, jaccardSimilarity, checkSemanticOverlap } from './checkSemanticOverlap';

describe('extractTrigrams', () => {
  it('builds sliding word-trigrams', () => {
    const set = extractTrigrams('the quick brown fox jumps');
    expect(set.has('the quick brown')).toBe(true);
    expect(set.has('quick brown fox')).toBe(true);
    expect(set.has('brown fox jumps')).toBe(true);
    expect(set.size).toBe(3);
  });

  it('returns empty set for fewer than 3 words', () => {
    expect(extractTrigrams('only two words').size).toBe(1);
    expect(extractTrigrams('one').size).toBe(0);
    expect(extractTrigrams('').size).toBe(0);
  });

  it('lowercases + strips punctuation', () => {
    const set = extractTrigrams('The Quick, Brown Fox.');
    expect(set.has('the quick brown')).toBe(true);
    expect(set.has('quick brown fox')).toBe(true);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    const s = new Set(['a', 'b', 'c']);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0);
  });

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it('computes |A∩B|/|A∪B| correctly', () => {
    // {a,b,c} ∩ {b,c,d} = 2; ∪ = 4; jaccard = 0.5.
    expect(jaccardSimilarity(new Set(['a', 'b', 'c']), new Set(['b', 'c', 'd']))).toBe(0.5);
  });
});

describe('checkSemanticOverlap', () => {
  it('exceeds when newText duplicates the rest of the article', () => {
    // Article has a long phrase that newText reuses verbatim. The remainder
    // of the article (after excluding the old range) shares many trigrams.
    const article = 'fox alpha beta gamma delta epsilon zeta eta theta iota.';
    const newText = 'alpha beta gamma delta epsilon zeta eta theta iota';
    const result = checkSemanticOverlap(
      newText,
      article,
      { start: 0, end: 4 }, // replacing "fox " — rest of article still has the long phrase
      0.35,
    );
    expect(result.exceeds).toBe(true);
    expect(result.overlap).toBeGreaterThan(0.35);
  });

  it('does NOT exceed when newText is novel', () => {
    const article = 'Old apples. Old bananas. Old cherries grow.';
    const result = checkSemanticOverlap(
      'completely different fresh content here',
      article,
      { start: 0, end: 11 },
      0.35,
    );
    expect(result.exceeds).toBe(false);
    expect(result.overlap).toBeLessThan(0.35);
  });

  it('returns 0 / no exceed when newText is empty', () => {
    const result = checkSemanticOverlap(
      '',
      'Some article text here. More content follows along.',
      { start: 0, end: 5 },
      0.35,
    );
    expect(result.overlap).toBe(0);
    expect(result.exceeds).toBe(false);
  });

  it('returns 0 / no exceed when newText is too short for trigrams', () => {
    const result = checkSemanticOverlap(
      'two words',
      'Some article text here. More content follows along.',
      { start: 0, end: 5 },
      0.35,
    );
    expect(result.overlap).toBe(0);
    expect(result.exceeds).toBe(false);
  });

  it('respects custom threshold', () => {
    const article = 'one two three four five six seven eight nine ten';
    // Use two trigrams overlapping with article.
    const newText = 'three four five';
    const high = checkSemanticOverlap(newText, article, { start: 0, end: 0 }, 0.99);
    const low = checkSemanticOverlap(newText, article, { start: 0, end: 0 }, 0.0);
    expect(high.exceeds).toBe(false);
    expect(low.exceeds).toBe(true);
  });

  it('excludes oldRange from the article when comparing', () => {
    const article = 'apple banana cherry date elderberry fig grape';
    const newText = 'apple banana cherry'; // matches article exactly at the old range
    // If we DIDN'T exclude oldRange, this would be a 100% match. With exclusion, 0%.
    const result = checkSemanticOverlap(newText, article, { start: 0, end: 19 }, 0.35);
    expect(result.exceeds).toBe(false);
  });
});
