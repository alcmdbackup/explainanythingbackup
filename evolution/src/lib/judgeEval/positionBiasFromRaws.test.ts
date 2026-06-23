// Unit tests for the position-bias derivation. Pins the bug surfaced on run
// 6a6549b7-f9a8: comparing raw forward and reverse letters directly without
// flipping the reverse to canonical INVERTS the metric. These tests force
// the flip + denominator semantics to stay correct.

import {
  computePositionBiasFromRaws,
  flipCanonical,
  narrowWinner,
  rubricPassWinner,
  emptyBias,
  type RawsRow,
} from './positionBiasFromRaws';

const DIMS = ['clarity', 'depth'];

function row(o: Partial<RawsRow>): RawsRow {
  return {
    pair_kind: 'article',
    holistic_forward_raw: null,
    holistic_reverse_raw: null,
    rubric_forward_raw: null,
    rubric_reverse_raw: null,
    ...o,
  };
}

describe('flipCanonical', () => {
  it('swaps A and B; TIE and null unchanged', () => {
    expect(flipCanonical('A')).toBe('B');
    expect(flipCanonical('B')).toBe('A');
    expect(flipCanonical('TIE')).toBe('TIE');
    expect(flipCanonical(null)).toBeNull();
  });
});

describe('narrowWinner', () => {
  it('narrows to A | B | TIE | null', () => {
    expect(narrowWinner('A')).toBe('A');
    expect(narrowWinner('B')).toBe('B');
    expect(narrowWinner('TIE')).toBe('TIE');
    expect(narrowWinner(null)).toBeNull();
    expect(narrowWinner('garbage')).toBeNull();
  });
});

describe('rubricPassWinner', () => {
  it('majority A → A', () => {
    expect(rubricPassWinner({ a: 'A', b: 'A', c: 'B' })).toBe('A');
  });
  it('majority B → B', () => {
    expect(rubricPassWinner({ a: 'B', b: 'B', c: 'A' })).toBe('B');
  });
  it('tie vote → TIE', () => {
    expect(rubricPassWinner({ a: 'A', b: 'B' })).toBe('TIE');
  });
  it('all TIE/null → null', () => {
    expect(rubricPassWinner({ a: 'TIE', b: null })).toBeNull();
  });
  it('null map → null', () => {
    expect(rubricPassWinner(null)).toBeNull();
  });
});

describe('computePositionBiasFromRaws', () => {
  it('unbiased holistic: forward="A", reverse="B" (raw) → canonical match, no bias', () => {
    // Reverse "B" flipped to canonical = "A". Both committed to A → match → unbiased.
    const out = computePositionBiasFromRaws(
      [row({ holistic_forward_raw: 'A', holistic_reverse_raw: 'B' })],
      [],
    );
    expect(out.article.holisticParsed).toBe(1);
    expect(out.article.holisticMismatch).toBe(0);
  });

  it('biased holistic: forward="B", reverse="B" (raw) → canonical mismatch, IS bias', () => {
    // Reverse "B" flipped to canonical = "A". Forward "B" != A → mismatch → BIAS.
    const out = computePositionBiasFromRaws(
      [row({ holistic_forward_raw: 'B', holistic_reverse_raw: 'B' })],
      [],
    );
    expect(out.article.holisticParsed).toBe(1);
    expect(out.article.holisticMismatch).toBe(1);
  });

  it('biased holistic: forward="A", reverse="A" (raw) → canonical mismatch, IS bias', () => {
    // Symmetric: model always picks the FIRST text in both passes.
    const out = computePositionBiasFromRaws(
      [row({ holistic_forward_raw: 'A', holistic_reverse_raw: 'A' })],
      [],
    );
    expect(out.article.holisticParsed).toBe(1);
    expect(out.article.holisticMismatch).toBe(1);
  });

  it('one-pass TIE: forward="A", reverse="TIE" → excluded from denominator', () => {
    const out = computePositionBiasFromRaws(
      [row({ holistic_forward_raw: 'A', holistic_reverse_raw: 'TIE' })],
      [],
    );
    expect(out.article.holisticParsed).toBe(0);
    expect(out.article.holisticMismatch).toBe(0);
  });

  it('mutual TIE: both passes returned TIE → excluded from denominator', () => {
    const out = computePositionBiasFromRaws(
      [row({ holistic_forward_raw: 'TIE', holistic_reverse_raw: 'TIE' })],
      [],
    );
    expect(out.article.holisticParsed).toBe(0);
  });

  it('null raws excluded from denominator', () => {
    const out = computePositionBiasFromRaws(
      [
        row({ holistic_forward_raw: null, holistic_reverse_raw: 'A' }),
        row({ holistic_forward_raw: 'B', holistic_reverse_raw: null }),
      ],
      [],
    );
    expect(out.article.holisticParsed).toBe(0);
  });

  it('aggregate matches the live numbers observed on run 6a6549b7 (rubric, paragraph slice)', () => {
    // 49 of 50 calls had unbiased rubric (raw letters opposite → canonical match);
    // 1 of 50 had biased rubric (raw letters same → canonical mismatch).
    // Build a synthetic batch matching that shape.
    const rows: RawsRow[] = [];
    for (let i = 0; i < 49; i += 1) {
      rows.push(
        row({
          pair_kind: 'paragraph',
          rubric_forward_raw: 'clarity: A\ndepth: A',
          rubric_reverse_raw: 'clarity: B\ndepth: B',
        }),
      );
    }
    rows.push(
      row({
        pair_kind: 'paragraph',
        rubric_forward_raw: 'clarity: A\ndepth: A',
        rubric_reverse_raw: 'clarity: A\ndepth: A', // same raw letters → biased
      }),
    );
    const out = computePositionBiasFromRaws(rows, DIMS);
    expect(out.paragraph.rubricParsed).toBe(50);
    expect(out.paragraph.rubricMismatch).toBe(1);
    expect(out.paragraph.rubricMismatch / out.paragraph.rubricParsed).toBeCloseTo(0.02);
  });

  it('aggregate matches the live numbers observed on run 6a6549b7 (holistic, paragraph slice)', () => {
    // 114 of 150 had biased holistic (raw same → canonical mismatch);
    // 36 of 150 had unbiased holistic (raw opposite → canonical match).
    const rows: RawsRow[] = [];
    for (let i = 0; i < 114; i += 1) {
      rows.push(
        row({
          pair_kind: 'paragraph',
          holistic_forward_raw: 'B',
          holistic_reverse_raw: 'B', // model always picks the second text → bias
        }),
      );
    }
    for (let i = 0; i < 36; i += 1) {
      rows.push(
        row({
          pair_kind: 'paragraph',
          holistic_forward_raw: 'A',
          holistic_reverse_raw: 'B', // unbiased — canonical winners agree
        }),
      );
    }
    const out = computePositionBiasFromRaws(rows, []);
    expect(out.paragraph.holisticParsed).toBe(150);
    expect(out.paragraph.holisticMismatch).toBe(114);
    expect(out.paragraph.holisticMismatch / out.paragraph.holisticParsed).toBeCloseTo(0.76);
  });

  it('kind splits work — article vs paragraph counted separately', () => {
    const out = computePositionBiasFromRaws(
      [
        row({ pair_kind: 'article', holistic_forward_raw: 'B', holistic_reverse_raw: 'B' }), // bias
        row({ pair_kind: 'paragraph', holistic_forward_raw: 'A', holistic_reverse_raw: 'B' }), // unbiased
      ],
      [],
    );
    expect(out.article.holisticParsed).toBe(1);
    expect(out.article.holisticMismatch).toBe(1);
    expect(out.paragraph.holisticParsed).toBe(1);
    expect(out.paragraph.holisticMismatch).toBe(0);
    expect(out.both.holisticParsed).toBe(2);
    expect(out.both.holisticMismatch).toBe(1);
  });

  it('empty dimNames skips rubric entirely (no false zeros)', () => {
    const out = computePositionBiasFromRaws(
      [row({ rubric_forward_raw: 'clarity: A', rubric_reverse_raw: 'clarity: B' })],
      [],
    );
    expect(out.article.rubricParsed).toBe(0);
    expect(out.article.rubricMismatch).toBe(0);
  });

  it('emptyBias is a fresh zero record', () => {
    const e = emptyBias();
    expect(e).toEqual({
      holisticMismatch: 0,
      holisticParsed: 0,
      rubricMismatch: 0,
      rubricParsed: 0,
    });
    // Mutating the returned record doesn't affect future calls.
    e.holisticParsed = 99;
    expect(emptyBias().holisticParsed).toBe(0);
  });
});
