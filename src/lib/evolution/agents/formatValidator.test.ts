// Unit tests for format validator.
// Verifies H1, section headings, bullet detection, sentence count rules.

import { validateFormat } from './formatValidator';

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
});
