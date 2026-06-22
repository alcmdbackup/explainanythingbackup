// Unit tests for slotProvenance helpers.
//
// CRITICAL: documents the known REORDER/RESTRUCTURE false-positive behavior so future
// readers see the noise characteristics in the test itself, not just in metrics.md.

import { slotProvenanceRatio, provenancePercentiles } from './slotProvenance';

describe('slotProvenanceRatio', () => {
  it('returns ~1.0 when child is identical to parent (no rewrite)', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    expect(slotProvenanceRatio(text, text)).toBe(1.0);
  });

  it('returns ~1.0 when child is a strict subset of parent (TIGHTEN — sentences deleted)', () => {
    const parent = 'First sentence. Second sentence. Third sentence.';
    const child = 'First sentence. Third sentence.';
    // All CHILD sentences exist in parent → ratio = 1.0
    expect(slotProvenanceRatio(parent, child)).toBe(1.0);
  });

  it('returns 0.0 when child has zero overlap with parent (new content invented)', () => {
    const parent = 'The cat sat on the mat.';
    const child = 'Quantum mechanics describes subatomic particles.';
    expect(slotProvenanceRatio(parent, child)).toBe(0.0);
  });

  it('DOCUMENTED FALSE-POSITIVE: REORDER directive — word-reordering within a sentence flags low', () => {
    // The user's REORDER directive permits reordering sentences (which DOES preserve
    // sentence-level matching) AND reordering words within a sentence (which DOES NOT).
    // The agent doesn't constrain to "sentence-level reorderings only", so the metric
    // is NOISY for REORDER outputs. This test documents the behavior.
    const parent = 'The dog ran quickly.';
    const child = 'Quickly, the dog ran.';
    // Child sentence "Quickly, the dog ran." does NOT near-match (within Levenshtein 2)
    // "The dog ran quickly." → ratio is 0, even though no new content was added.
    expect(slotProvenanceRatio(parent, child)).toBeLessThan(0.5);
  });

  it('DOCUMENTED FALSE-POSITIVE: RESTRUCTURE — split sentences flag low', () => {
    // RESTRUCTURE permits splitting one sentence into two. The split child sentences
    // are smaller fragments that don't near-match the original combined sentence.
    const parent = 'The dog ran quickly across the wide green field.';
    const child = 'The dog ran. It went across the wide green field.';
    // Child has 2 sentences, neither near-matches the original combined sentence.
    expect(slotProvenanceRatio(parent, child)).toBeLessThan(0.5);
  });

  it('handles empty child (degenerate)', () => {
    // sentenceVerbatimOverlap returns 1.0 when there are zero sentences in the "parent"
    // argument (which is `childParagraph` in our swapped call) — degenerate case.
    expect(slotProvenanceRatio('Parent text.', '')).toBe(1.0);
  });

  it('handles empty parent', () => {
    // Child has sentences, parent has none → no child sentence can match.
    expect(slotProvenanceRatio('', 'Some child sentence.')).toBe(0.0);
  });
});

describe('provenancePercentiles', () => {
  it('returns p25 and p50 over a finite-only input list', () => {
    const ratios = [0.1, 0.3, 0.5, 0.7, 0.9];
    const result = provenancePercentiles(ratios);
    expect(result.n).toBe(5);
    expect(result.p25).toBe(0.3);
    expect(result.p50).toBe(0.5);
  });

  it('drops NaN/Infinity values', () => {
    const ratios = [0.5, NaN, 0.7, Infinity, 0.3];
    const result = provenancePercentiles(ratios);
    expect(result.n).toBe(3);
    expect(result.p50).toBe(0.5); // median of [0.3, 0.5, 0.7]
  });

  it('returns {p25: 0, p50: 0, n: 0} on empty input', () => {
    expect(provenancePercentiles([])).toEqual({ p25: 0, p50: 0, n: 0 });
  });

  it('returns the single value for p25 and p50 on single-element input', () => {
    expect(provenancePercentiles([0.42])).toEqual({ p25: 0.42, p50: 0.42, n: 1 });
  });

  it('interpolates between values for non-exact percentiles', () => {
    // [0.0, 0.5, 1.0] — p25 should be 0.25 (linear interp between idx 0 and idx 1).
    const result = provenancePercentiles([0.0, 0.5, 1.0]);
    expect(result.p25).toBe(0.25);
    expect(result.p50).toBe(0.5);
  });
});
