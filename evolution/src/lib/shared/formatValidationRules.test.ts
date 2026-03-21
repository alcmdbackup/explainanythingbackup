// Tests for shared format validation rule functions used by both
// formatValidator.ts (full article) and sectionFormatValidator.ts (section).

import {
  stripCodeBlocks,
  stripHorizontalRules,
  hasBulletPoints,
  hasNumberedLists,
  hasTables,
  extractParagraphs,
  countShortParagraphs,
  checkParagraphSentenceCount,
} from './formatValidationRules';

describe('stripCodeBlocks', () => {
  it('removes matched code fences', () => {
    const text = 'before\n```\ncode\n```\nafter';
    expect(stripCodeBlocks(text)).toContain('after');
    expect(stripCodeBlocks(text)).not.toContain('code');
  });

  it('removes unclosed trailing code fence', () => {
    const text = 'before\n```\nunclosed';
    expect(stripCodeBlocks(text)).toContain('before');
    expect(stripCodeBlocks(text)).not.toContain('unclosed');
  });

  it('handles text with no code blocks', () => {
    const text = 'plain text here';
    expect(stripCodeBlocks(text)).toBe('plain text here');
  });

  it('handles multiple code blocks', () => {
    const text = 'a\n```\nblock1\n```\nb\n```\nblock2\n```\nc';
    const result = stripCodeBlocks(text);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
    expect(result).not.toContain('block1');
    expect(result).not.toContain('block2');
  });

  it('preserves content after last closed block (PARSE-6)', () => {
    const text = '```\ncode\n```\nSurviving paragraph.';
    const result = stripCodeBlocks(text);
    expect(result).toContain('Surviving paragraph.');
  });
});

describe('stripHorizontalRules', () => {
  it('removes --- style rules', () => {
    const text = 'before\n---\nafter';
    expect(stripHorizontalRules(text)).not.toMatch(/^---$/m);
  });

  it('removes *** style rules', () => {
    const text = 'before\n***\nafter';
    expect(stripHorizontalRules(text)).not.toMatch(/^\*\*\*$/m);
  });

  it('removes ___ style rules', () => {
    const text = 'before\n___\nafter';
    expect(stripHorizontalRules(text)).not.toMatch(/^___$/m);
  });

  it('preserves normal text', () => {
    const text = 'normal text here';
    expect(stripHorizontalRules(text)).toBe('normal text here');
  });
});

describe('hasBulletPoints', () => {
  it('detects dash bullets', () => {
    expect(hasBulletPoints('- item')).toBe(true);
  });

  it('detects asterisk bullets', () => {
    expect(hasBulletPoints('* item')).toBe(true);
  });

  it('detects plus bullets', () => {
    expect(hasBulletPoints('+ item')).toBe(true);
  });

  it('detects indented bullets', () => {
    expect(hasBulletPoints('  - item')).toBe(true);
  });

  it('returns false for normal text', () => {
    expect(hasBulletPoints('This is a sentence.')).toBe(false);
  });

  it('returns false for horizontal rules', () => {
    // Horizontal rules should be stripped before calling this
    expect(hasBulletPoints('text without bullets')).toBe(false);
  });
});

describe('hasNumberedLists', () => {
  it('detects 1. style', () => {
    expect(hasNumberedLists('1. item')).toBe(true);
  });

  it('detects 1) style', () => {
    expect(hasNumberedLists('1) item')).toBe(true);
  });

  it('detects multi-digit numbers', () => {
    expect(hasNumberedLists('10. item')).toBe(true);
  });

  it('detects indented numbered lists', () => {
    expect(hasNumberedLists('  2. item')).toBe(true);
  });

  it('returns false for normal text', () => {
    expect(hasNumberedLists('This is a sentence.')).toBe(false);
  });
});

describe('hasTables', () => {
  it('detects markdown tables', () => {
    expect(hasTables('| col1 | col2 |')).toBe(true);
  });

  it('detects table separators', () => {
    expect(hasTables('| --- | --- |')).toBe(true);
  });

  it('returns false for normal text', () => {
    expect(hasTables('This is a sentence.')).toBe(false);
  });
});

describe('extractParagraphs', () => {
  it('extracts paragraphs from text', () => {
    const text = 'First paragraph here.\n\nSecond paragraph here.';
    const paras = extractParagraphs(text);
    expect(paras).toHaveLength(2);
  });

  it('skips headings', () => {
    const text = '## Heading\n\nParagraph here.';
    const paras = extractParagraphs(text);
    expect(paras).toHaveLength(1);
    expect(paras[0]).toBe('Paragraph here.');
  });

  it('skips horizontal rules', () => {
    const text = 'Para one.\n\n---\n\nPara two.';
    const paras = extractParagraphs(text);
    expect(paras).toHaveLength(2);
    expect(paras.every((p) => !p.includes('---'))).toBe(true);
  });

  it('skips emphasis-only lines', () => {
    const text = '*emphasis text*\n\nParagraph here.';
    const paras = extractParagraphs(text);
    expect(paras).toHaveLength(1);
  });

  it('skips label lines ending with colon', () => {
    const text = 'Some label:\n\nParagraph here.';
    const paras = extractParagraphs(text);
    expect(paras).toHaveLength(1);
  });

  it('returns empty array for empty text', () => {
    expect(extractParagraphs('')).toHaveLength(0);
  });
});

describe('countShortParagraphs', () => {
  it('counts paragraphs with fewer than 2 sentences', () => {
    const paras = ['Short.', 'Also short.', 'This has two sentences. Really it does.'];
    expect(countShortParagraphs(paras)).toBe(2);
  });

  it('handles smart quotes in sentence endings', () => {
    const paras = ['\u201cQuoted sentence.\u201d Another sentence here.'];
    expect(countShortParagraphs(paras)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(countShortParagraphs([])).toBe(0);
  });

  it('counts all short when all single-sentence', () => {
    const paras = ['One.', 'Two.', 'Three.'];
    expect(countShortParagraphs(paras)).toBe(3);
  });
});

describe('checkParagraphSentenceCount', () => {
  it('returns null when paragraphs are well-formed', () => {
    const text = 'This is a good paragraph. It has two sentences.\n\nAnother good one here. With more detail.';
    expect(checkParagraphSentenceCount(text)).toBeNull();
  });

  it('returns issue message when too many short paragraphs', () => {
    const text = 'Short.\n\nAlso.\n\nYep.\n\nAnother.\n\nMore.';
    const result = checkParagraphSentenceCount(text);
    expect(result).not.toBeNull();
    expect(result).toContain('paragraphs with <2 sentences');
  });

  it('tolerates up to 25% short paragraphs', () => {
    // 1 short out of 4 = 25%, should still pass
    const text = 'Short.\n\nGood paragraph one. With two sentences.\n\nGood paragraph two. With detail.\n\nGood paragraph three. More detail here.';
    const result = checkParagraphSentenceCount(text);
    expect(result).toBeNull();
  });

  it('returns null for text with no paragraphs', () => {
    expect(checkParagraphSentenceCount('## Just a heading')).toBeNull();
  });

  it('uses custom tolerance when provided', () => {
    // 2 short out of 3 = 66% - fails at 25% but passes at 75%
    const text = 'Short.\n\nAlso short.\n\nThis one has two sentences. It is valid.';
    expect(checkParagraphSentenceCount(text, 0.25)).not.toBeNull();
    expect(checkParagraphSentenceCount(text, 0.75)).toBeNull();
  });
});
