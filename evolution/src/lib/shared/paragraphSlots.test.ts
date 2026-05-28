// Unit tests for paragraphSlots helpers.
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.

import {
  extractParagraphsWithRanges,
  validateParagraphRewrite,
  assembleRecombinedArticle,
} from './paragraphSlots';

describe('extractParagraphsWithRanges', () => {
  it('returns paragraph blocks with byte ranges that round-trip to the original text', () => {
    const text = `# Title\n\nFirst paragraph here.\n\nSecond paragraph.`;
    const slots = extractParagraphsWithRanges(text);
    expect(slots).toHaveLength(2);
    expect(slots[0]!.originalText).toBe('First paragraph here.');
    expect(slots[0]!.paragraphIndex).toBe(0);
    expect(text.slice(slots[0]!.startByte, slots[0]!.endByte).trim()).toBe('First paragraph here.');
    expect(slots[1]!.originalText).toBe('Second paragraph.');
    expect(slots[1]!.paragraphIndex).toBe(1);
  });

  it('filters out heading-only blocks', () => {
    const text = `# Title\n\n## Section\n\nA paragraph.\n\n### Subsection\n\nAnother paragraph.`;
    const slots = extractParagraphsWithRanges(text);
    expect(slots.map((s) => s.originalText)).toEqual(['A paragraph.', 'Another paragraph.']);
  });

  it('filters out horizontal-rule blocks', () => {
    const text = `First.\n\n---\n\nSecond.`;
    const slots = extractParagraphsWithRanges(text);
    expect(slots.map((s) => s.originalText)).toEqual(['First.', 'Second.']);
  });

  it('filters out emphasis-only blocks and label-with-colon blocks', () => {
    const text = `Para one.\n\n*italics only*\n\nLabel:\n\nPara two.`;
    const slots = extractParagraphsWithRanges(text);
    expect(slots.map((s) => s.originalText)).toEqual(['Para one.', 'Para two.']);
  });

  it('skips paragraphs inside code-fenced blocks', () => {
    const text = `Real paragraph.\n\n\`\`\`\nfake paragraph inside code\n\nmore code\n\`\`\`\n\nAnother real paragraph.`;
    const slots = extractParagraphsWithRanges(text);
    // The code-fenced contents should be excluded; we get the two real paragraphs.
    expect(slots.map((s) => s.originalText)).toEqual([
      'Real paragraph.',
      'Another real paragraph.',
    ]);
  });

  it('returns empty array on empty input', () => {
    expect(extractParagraphsWithRanges('')).toEqual([]);
  });

  it('handles a single paragraph (no \\n\\n)', () => {
    const text = `One paragraph, no separator.`;
    const slots = extractParagraphsWithRanges(text);
    expect(slots).toHaveLength(1);
    expect(slots[0]!.originalText).toBe('One paragraph, no separator.');
    expect(slots[0]!.startByte).toBe(0);
    expect(slots[0]!.endByte).toBe(text.length);
  });
});

describe('validateParagraphRewrite', () => {
  const baseline = 'A reasonably long paragraph with enough text to test length ratios.';

  it('accepts a same-length faithful rewrite', () => {
    const rewrite = 'A reasonable paragraph with sufficient text to test length ratios.';
    const result = validateParagraphRewrite(rewrite, baseline.length);
    expect(result.valid).toBe(true);
    expect(result.dropReason).toBeUndefined();
  });

  it('rejects rewrites with bullet points', () => {
    const result = validateParagraphRewrite(
      `Intro line.\n- bullet one\n- bullet two`,
      baseline.length,
    );
    expect(result.valid).toBe(false);
    expect(result.dropReason).toBe('no_bullets');
  });

  it('rejects rewrites with numbered lists', () => {
    const result = validateParagraphRewrite(
      `Intro line.\n1. item one\n2. item two`,
      baseline.length,
    );
    expect(result.valid).toBe(false);
    expect(result.dropReason).toBe('no_lists');
  });

  it('rejects rewrites with tables', () => {
    const result = validateParagraphRewrite(
      `Intro line.\n| col1 | col2 |\n| --- | --- |`,
      baseline.length,
    );
    expect(result.valid).toBe(false);
    expect(result.dropReason).toBe('no_tables');
  });

  it('rejects rewrites that contain an H1', () => {
    const result = validateParagraphRewrite(
      `# An H1 heading\n\nSome text.`,
      baseline.length,
    );
    expect(result.valid).toBe(false);
    expect(result.dropReason).toBe('no_h1');
  });

  it('rejects rewrites shorter than 90% of the original', () => {
    const result = validateParagraphRewrite('Way too short.', baseline.length);
    expect(result.valid).toBe(false);
    expect(result.dropReason).toBe('length_under');
  });

  it('rejects rewrites longer than 110% of the original', () => {
    const tooLong = baseline + ' '.repeat(baseline.length); // 200% of original
    const result = validateParagraphRewrite(tooLong, baseline.length);
    expect(result.valid).toBe(false);
    expect(result.dropReason).toBe('length_over');
  });

  it('rejects rewrites with no sentence-ending punctuation', () => {
    // Same length as baseline, but no period/!/?
    const noPunct = 'a'.repeat(baseline.length);
    const result = validateParagraphRewrite(noPunct, baseline.length);
    expect(result.valid).toBe(false);
    expect(result.dropReason).toBe('zero_sentences');
  });
});

describe('assembleRecombinedArticle', () => {
  it('replaces only the slots present in the winners map', () => {
    const parent = `# Title\n\nFirst.\n\nSecond.\n\nThird.`;
    const slots = extractParagraphsWithRanges(parent);
    const winners = new Map<number, string>();
    winners.set(1, 'Second rewritten.');
    const result = assembleRecombinedArticle(parent, slots, winners);
    expect(result).toBe(`# Title\n\nFirst.\n\nSecond rewritten.\n\nThird.`);
  });

  it('preserves the parent text when no winners are provided', () => {
    const parent = `# Title\n\nFirst.\n\nSecond.`;
    const slots = extractParagraphsWithRanges(parent);
    const result = assembleRecombinedArticle(parent, slots, new Map());
    expect(result).toBe(parent);
  });

  it('splices right-to-left so earlier slot byte offsets stay valid', () => {
    const parent = `One.\n\nTwo.\n\nThree.`;
    const slots = extractParagraphsWithRanges(parent);
    const winners = new Map<number, string>();
    // Replace BOTH first and third — needs right-to-left to keep first's range valid.
    winners.set(0, 'One has been completely rewritten with more text.');
    winners.set(2, 'Three!');
    const result = assembleRecombinedArticle(parent, slots, winners);
    expect(result).toBe(`One has been completely rewritten with more text.\n\nTwo.\n\nThree!`);
  });
});
