// Unit tests for parseArticleIntoSections: round-trip fidelity, edge cases, code block handling.

import { parseArticleIntoSections } from './sectionParser';
import { stitchSections } from './sectionStitcher';

// ─── Inline fixtures ──────────────────────────────────────────────

const MULTI_SECTION_ARTICLE = `# Great Article Title

This is the preamble paragraph with multiple sentences. It introduces the topic well.

## First Section

This section discusses the basics. It provides foundational context for the reader.

### A Subsection

Nested H3 content lives inside the H2 section. It adds detail without breaking the parent.

## Second Section

Another section with more prose. This one covers advanced topics in depth.

## Third Section

The final section wraps up the discussion. It provides a clear conclusion for readers.
`;

const ARTICLE_WITH_CODE_BLOCK = `# Code Example Article

Introduction paragraph here. It sets the stage for the code examples.

## Configuration

Here is a configuration example with a heading inside a code block:

\`\`\`markdown
## This is NOT a section heading
It's inside a code block and should be ignored.
\`\`\`

The paragraph after the code block continues normally. It explains the configuration.

## Implementation

The implementation details follow. They show how to apply the configuration in practice.
`;

const NO_H2_ARTICLE = `# Title Only

This article has no H2 headings at all. It is just a single block of text with multiple sentences.

It has a second paragraph too. This paragraph adds more content to the article.
`;

const SINGLE_H2_ARTICLE = `# Article Title

Brief intro. It sets context.

## Only Section

This is the only H2 section. It contains all the content for this article.
`;

const EMPTY_PREAMBLE_ARTICLE = `## First Section

This article starts immediately with an H2. There is no preamble at all.

## Second Section

Another section follows. It provides additional information.
`;

// ─── Tests ────────────────────────────────────────────────────────

describe('parseArticleIntoSections', () => {
  it('parses multi-section article with preamble', () => {
    const result = parseArticleIntoSections(MULTI_SECTION_ARTICLE);
    expect(result.sectionCount).toBe(3);
    expect(result.sections).toHaveLength(4); // preamble + 3 sections

    // Preamble
    expect(result.sections[0].isPreamble).toBe(true);
    expect(result.sections[0].heading).toBeNull();
    expect(result.sections[0].index).toBe(0);

    // Section headings
    expect(result.sections[1].heading).toBe('First Section');
    expect(result.sections[1].isPreamble).toBe(false);
    expect(result.sections[2].heading).toBe('Second Section');
    expect(result.sections[3].heading).toBe('Third Section');
  });

  it('includes H3 content within the parent H2 section', () => {
    const result = parseArticleIntoSections(MULTI_SECTION_ARTICLE);
    const firstSection = result.sections[1];
    expect(firstSection.markdown).toContain('### A Subsection');
    expect(firstSection.markdown).toContain('Nested H3 content');
  });

  it('round-trips: stitch(parse(md)) === md', () => {
    const result = parseArticleIntoSections(MULTI_SECTION_ARTICLE);
    const stitched = stitchSections(result.sections);
    expect(stitched).toBe(MULTI_SECTION_ARTICLE);
  });

  it('round-trips article with code blocks containing ##', () => {
    const result = parseArticleIntoSections(ARTICLE_WITH_CODE_BLOCK);
    const stitched = stitchSections(result.sections);
    expect(stitched).toBe(ARTICLE_WITH_CODE_BLOCK);
  });

  it('does not treat ## inside code block as section boundary', () => {
    const result = parseArticleIntoSections(ARTICLE_WITH_CODE_BLOCK);
    // Should have: preamble, Configuration, Implementation (3 total, 2 H2)
    expect(result.sectionCount).toBe(2);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[1].heading).toBe('Configuration');
    expect(result.sections[2].heading).toBe('Implementation');
    // The code block content should be inside Configuration section
    expect(result.sections[1].markdown).toContain('## This is NOT a section heading');
  });

  it('handles article with no H2 headings (entire text is preamble)', () => {
    const result = parseArticleIntoSections(NO_H2_ARTICLE);
    expect(result.sectionCount).toBe(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].isPreamble).toBe(true);
    expect(result.sections[0].markdown).toBe(NO_H2_ARTICLE);
  });

  it('handles article with exactly 1 H2 section', () => {
    const result = parseArticleIntoSections(SINGLE_H2_ARTICLE);
    expect(result.sectionCount).toBe(1);
    expect(result.sections).toHaveLength(2); // preamble + 1 section
    expect(result.sections[1].heading).toBe('Only Section');
  });

  it('handles article with no preamble (starts with H2)', () => {
    const result = parseArticleIntoSections(EMPTY_PREAMBLE_ARTICLE);
    expect(result.sectionCount).toBe(2);
    // No preamble section because there's nothing before the first ##
    expect(result.sections[0].heading).toBe('First Section');
    expect(result.sections[0].isPreamble).toBe(false);
  });

  it('round-trips no-preamble article', () => {
    const result = parseArticleIntoSections(EMPTY_PREAMBLE_ARTICLE);
    const stitched = stitchSections(result.sections);
    expect(stitched).toBe(EMPTY_PREAMBLE_ARTICLE);
  });

  it('round-trips single-H2 article', () => {
    const result = parseArticleIntoSections(SINGLE_H2_ARTICLE);
    const stitched = stitchSections(result.sections);
    expect(stitched).toBe(SINGLE_H2_ARTICLE);
  });

  it('round-trips no-H2 article', () => {
    const result = parseArticleIntoSections(NO_H2_ARTICLE);
    const stitched = stitchSections(result.sections);
    expect(stitched).toBe(NO_H2_ARTICLE);
  });

  it('preserves originalText reference', () => {
    const result = parseArticleIntoSections(MULTI_SECTION_ARTICLE);
    expect(result.originalText).toBe(MULTI_SECTION_ARTICLE);
  });

  it('assigns sequential indices', () => {
    const result = parseArticleIntoSections(MULTI_SECTION_ARTICLE);
    result.sections.forEach((section, i) => {
      expect(section.index).toBe(i);
    });
  });

  it('handles empty string', () => {
    const result = parseArticleIntoSections('');
    expect(result.sectionCount).toBe(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].isPreamble).toBe(true);
  });

  it('handles unclosed code block at end of file', () => {
    const article = `# Title

Intro. More text here.

## Section One

Content here. Extra sentences added.

\`\`\`
## This is unclosed
Some code
`;
    const result = parseArticleIntoSections(article);
    expect(result.sectionCount).toBe(1);
    const stitched = stitchSections(result.sections);
    expect(stitched).toBe(article);
  });
});
