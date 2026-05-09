// Tests for the deterministic drift snap-to-source replacement for recoverDrift.

import { snapDriftToSource } from './snapDriftToSource';
import type { EditingDriftRegion } from './types';

function region(offset: number, drifted: string): EditingDriftRegion {
  return { offset, driftedText: drifted };
}

describe('snapDriftToSource', () => {
  it('replaces a single drift region with the source slice at the same offset', () => {
    const proposed = 'aaa“bb”ccc'; // smart quotes drifted
    const current = 'aaa"bb"ccc'; // straight quotes
    const r = snapDriftToSource({
      regions: [region(3, '“'), region(6, '”')],
      proposedMarkup: proposed,
      currentText: current,
    });
    expect(r.patchedMarkup).toBe('aaa"bb"ccc');
    expect(r.classifications).toHaveLength(2);
    expect(r.classifications[0]?.classification).toBe('benign');
    expect(r.classifications[0]?.patch).toBe('"');
    expect(r.classifications[1]?.patch).toBe('"');
  });

  it('applies regions in reverse-offset order so earlier offsets do not shift', () => {
    // If we patched offset 0 first (length 3) it would shift offset 5 by -2.
    // Reverse order is required for correctness.
    const r = snapDriftToSource({
      regions: [region(0, 'XXX'), region(5, 'YYY')],
      proposedMarkup: 'XXX..YYY..',
      currentText: 'aaa..bbb..',
    });
    expect(r.patchedMarkup).toBe('aaa..bbb..');
  });

  it('handles a single drift region (the common case from checkProposerDrift)', () => {
    // checkProposerDrift today produces ONE region (entire mismatched suffix).
    const r = snapDriftToSource({
      regions: [region(10, 'drifted suffix here')],
      proposedMarkup: 'unchanged drifted suffix here',
      currentText: 'unchanged original suffix text',
    });
    // proposedMarkup: 'unchanged drifted suffix here' (29 chars; offset 10..29)
    // splice in currentText.slice(10, 10+19) = 'original suffix tex'
    // result: 'unchanged' + 'original suffix tex' = 29 chars
    expect(r.patchedMarkup).toBe('unchanged original suffix tex');
  });

  it('returns empty classifications for empty regions input', () => {
    const r = snapDriftToSource({
      regions: [],
      proposedMarkup: 'foo',
      currentText: 'foo',
    });
    expect(r.patchedMarkup).toBe('foo');
    expect(r.classifications).toEqual([]);
  });

  it('classifications come back in offset-ascending order even though we splice in reverse', () => {
    const r = snapDriftToSource({
      regions: [region(20, 'b'), region(5, 'a'), region(40, 'c')],
      proposedMarkup: 'x'.repeat(50),
      currentText: 'y'.repeat(50),
    });
    expect(r.classifications.map((c) => c.offset)).toEqual([5, 20, 40]);
  });

  it('aborts with aborted=true when a source slice contains CriticMarkup delimiters', () => {
    // If the source text inside the drift region contains `{++` etc., splicing
    // would mint fake edit markers that the re-parser would treat as real edits.
    const r = snapDriftToSource({
      regions: [region(0, 'XX')],
      proposedMarkup: 'XX rest',
      // Source has a literal `{++` at offset 0..2 (length 2 of the slice).
      // Slice = currentText.slice(0, 2) = '{+' which is markup-suspicious — but
      // sourceContainsMarkup only triggers on full `{++`. Use length 3 to hit it.
      currentText: '{++ literal',
    });
    // This 2-char slice doesn't trigger the guard; verify normal behavior here.
    expect(r.aborted).toBeUndefined();

    const r2 = snapDriftToSource({
      regions: [region(0, 'XXX')],
      proposedMarkup: 'XXX rest',
      currentText: '{++ literal',
    });
    // 3-char slice = '{++' triggers the guard.
    expect(r2.aborted).toBe(true);
    expect(r2.patchedMarkup).toBe('XXX rest'); // unchanged
    expect(r2.classifications.every((c) => c.classification === 'intentional')).toBe(true);
  });
});
