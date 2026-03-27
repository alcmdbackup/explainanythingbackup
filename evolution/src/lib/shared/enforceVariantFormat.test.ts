// Unit tests for format validator.
// Verifies H1, section headings, bullet detection, sentence count rules.

import { validateFormat } from './enforceVariantFormat';

const VALID_ARTICLE = `# Great Title

## Introduction

This is a well-formed paragraph with multiple sentences. It meets the requirements for paragraph length.

## Section Two

Here we have another paragraph that explains the concept clearly. The sentences flow naturally and make sense together.

### Subsection

This subsection adds detail to the topic. It elaborates on the key ideas presented above.`;

describe('validateFormat', () => {
  it('accepts valid article', () => {
    const result = validateFormat(VALID_ARTICLE);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects empty text', () => {
    const result = validateFormat('');
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Empty text');
  });

  it('rejects missing H1', () => {
    const result = validateFormat('## Only subheading\n\nSome paragraph text here. With two sentences.');
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Missing H1 title');
  });

  it('rejects multiple H1s', () => {
    const text = '# First Title\n\n## Section\n\nText here. More text.\n\n# Second Title\n\n## Section\n\nMore text. Even more.';
    const result = validateFormat(text);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('Multiple H1'))).toBe(true);
  });

  it('rejects missing section headings', () => {
    const result = validateFormat('# Title Only\n\nJust a paragraph. With some sentences.');
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('No section headings (## or ###)');
  });

  it('rejects bullet points', () => {
    const text = '# Title\n\n## Section\n\nSome text before. More text here.\n\n- bullet 1\n- bullet 2';
    const result = validateFormat(text);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Contains bullet points');
  });

  it('rejects numbered lists', () => {
    const text = '# Title\n\n## Section\n\nSome text before. More text here.\n\n1. first item\n2. second item';
    const result = validateFormat(text);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Contains numbered lists');
  });

  it('rejects tables', () => {
    const text = '# Title\n\n## Section\n\nSome text before. More text here.\n\n| col1 | col2 |\n| --- | --- |';
    const result = validateFormat(text);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Contains tables');
  });

  it('allows code blocks with bullets inside', () => {
    const text = '# Title\n\n## Section\n\nHere is a code example that is important. It shows the concept clearly.\n\n```\n- this is inside a code block\n```\n\n## Next Section\n\nMore text after the code block. This continues the discussion.';
    const result = validateFormat(text);
    expect(result.issues.includes('Contains bullet points')).toBe(false);
  });

  it('returns valid=true with issues in warn mode', () => {
    const original = process.env.FORMAT_VALIDATION_MODE;
    process.env.FORMAT_VALIDATION_MODE = 'warn';
    try {
      const result = validateFormat('no H1 here');
      expect(result.valid).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
    } finally {
      if (original !== undefined) {
        process.env.FORMAT_VALIDATION_MODE = original;
      } else {
        delete process.env.FORMAT_VALIDATION_MODE;
      }
    }
  });

  it('skips all checks in off mode', () => {
    const original = process.env.FORMAT_VALIDATION_MODE;
    process.env.FORMAT_VALIDATION_MODE = 'off';
    try {
      const result = validateFormat('anything goes');
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    } finally {
      if (original !== undefined) {
        process.env.FORMAT_VALIDATION_MODE = original;
      } else {
        delete process.env.FORMAT_VALIDATION_MODE;
      }
    }
  });

  // PARSE-5: Leading blank lines before H1 should be accepted
  it('accepts leading blank lines before H1', () => {
    const text = '\n\n' + VALID_ARTICLE;
    const result = validateFormat(text);
    expect(result.valid).toBe(true);
  });

  // PARSE-6: Code block stripping preserves content after last closed block
  it('preserves content after last closed code block', () => {
    const text = '# Title\n\n## Section\n\n```\ncode here\n```\n\nThis paragraph should survive. It has multiple sentences.\n\n## Another Section\n\nMore content here. With sentences.';
    const result = validateFormat(text);
    expect(result.valid).toBe(true);
  });

  it('strips unclosed trailing code fence without affecting prior content', () => {
    const text = '# Title\n\n## Section\n\nGood paragraph here. With sentences.\n\n```\nunclosed code block';
    const result = validateFormat(text);
    // Should not report bullet issues from inside the unclosed block
    expect(result.issues.includes('Contains bullet points')).toBe(false);
  });

  // Regression: H3+ headings must NOT be detected as H1
  it('does not treat H3 headings as H1', () => {
    const text = '# Real Title\n\n## Section\n\n### Subsection\n\nThis paragraph has enough sentences. It explains the topic well.';
    const result = validateFormat(text);
    expect(result.valid).toBe(true);
    expect(result.issues.some((i) => i.includes('Multiple H1'))).toBe(false);
  });

  it('does not treat H4 or deeper headings as H1', () => {
    const text = '#### Deep Heading\n\n## Section\n\nSome text here. More text follows.';
    const result = validateFormat(text);
    // Should report missing H1, NOT multiple H1
    expect(result.issues).toContain('Missing H1 title');
    expect(result.issues.some((i) => i.includes('Multiple H1'))).toBe(false);
  });

  it('still detects actual multiple H1 headings', () => {
    const text = '# First\n\n## Section\n\nParagraph text here. More text.\n\n# Second\n\n## Section\n\nMore text. Even more.';
    const result = validateFormat(text);
    expect(result.issues.some((i) => i.includes('Multiple H1'))).toBe(true);
  });

  // Regression: FORMAT_VALIDATION_MODE should be case-insensitive
  it('treats uppercase WARN mode correctly', () => {
    const original = process.env.FORMAT_VALIDATION_MODE;
    process.env.FORMAT_VALIDATION_MODE = 'WARN';
    try {
      const result = validateFormat('no H1 here');
      expect(result.valid).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
    } finally {
      if (original !== undefined) {
        process.env.FORMAT_VALIDATION_MODE = original;
      } else {
        delete process.env.FORMAT_VALIDATION_MODE;
      }
    }
  });

  it('treats uppercase OFF mode correctly', () => {
    const original = process.env.FORMAT_VALIDATION_MODE;
    process.env.FORMAT_VALIDATION_MODE = 'OFF';
    try {
      const result = validateFormat('anything');
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    } finally {
      if (original !== undefined) {
        process.env.FORMAT_VALIDATION_MODE = original;
      } else {
        delete process.env.FORMAT_VALIDATION_MODE;
      }
    }
  });
});
