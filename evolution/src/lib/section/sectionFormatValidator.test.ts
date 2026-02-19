// Unit tests for section format validator: relaxed rules for individual sections.

import { validateSectionFormat } from './sectionFormatValidator';

describe('validateSectionFormat', () => {
  it('accepts valid non-preamble section with H2 heading + prose', () => {
    const section = `## My Section

This is a valid paragraph with multiple sentences. It provides enough content for the validator.

Another paragraph follows with more detail. It elaborates on the topic introduced above.
`;
    const result = validateSectionFormat(section, false);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects non-preamble section without H2 heading', () => {
    const section = `This section has no heading at all. It starts directly with prose.

More content follows. It continues the discussion.
`;
    const result = validateSectionFormat(section, false);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('H2 heading'))).toBe(true);
  });

  it('rejects section text containing H1', () => {
    const section = `# This Is An H1

## My Section

Content here. More sentences follow for proper formatting.
`;
    const result = validateSectionFormat(section, false);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('H1'))).toBe(true);
  });

  it('allows H1 in preamble sections', () => {
    const section = `# Article Title

This is the preamble with an intro paragraph. It sets the stage for the article.
`;
    const result = validateSectionFormat(section, true);
    expect(result.valid).toBe(true);
  });

  it('rejects section with bullet points', () => {
    const section = `## Bullet Section

- First point
- Second point
`;
    const result = validateSectionFormat(section, false);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('bullet'))).toBe(true);
  });

  it('rejects section with numbered lists', () => {
    const section = `## List Section

1. First item
2. Second item
`;
    const result = validateSectionFormat(section, false);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('numbered'))).toBe(true);
  });

  it('rejects section with tables', () => {
    const section = `## Table Section

| Col A | Col B |
|-------|-------|
| val1  | val2  |
`;
    const result = validateSectionFormat(section, false);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('table'))).toBe(true);
  });

  it('rejects empty section', () => {
    const result = validateSectionFormat('', false);
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('Empty section');
  });

  it('accepts preamble without H2 heading', () => {
    const section = `This preamble has no heading. It is just introductory prose.

A second paragraph adds more context. It continues the introduction.
`;
    const result = validateSectionFormat(section, true);
    expect(result.valid).toBe(true);
  });

  it('enforces paragraph sentence count (25% tolerance)', () => {
    const section = `## Short Paras

Word.

Fragment.

Another.

Yet another.

One more.
`;
    const result = validateSectionFormat(section, false);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes('paragraphs with <2 sentences'))).toBe(true);
  });
});
