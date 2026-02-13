// Unit tests for stitchSections and stitchWithReplacements: reassembly, selective replacement.

import { parseArticleIntoSections } from './sectionParser';
import { stitchSections, stitchWithReplacements } from './sectionStitcher';
import { validateFormat } from '../agents/formatValidator';

// ─── Inline fixture ───────────────────────────────────────────────

const MULTI_SECTION_ARTICLE = `# Great Article Title

This is the preamble paragraph with multiple sentences. It introduces the topic well.

## First Section

This section discusses the basics. It provides foundational context for the reader.

## Second Section

Another section with more prose. This one covers advanced topics in depth.

## Third Section

The final section wraps up the discussion. It provides a clear conclusion for readers.
`;

// ─── Tests ────────────────────────────────────────────────────────

describe('stitchSections', () => {
  it('reconstructs the original article from parsed sections', () => {
    const parsed = parseArticleIntoSections(MULTI_SECTION_ARTICLE);
    const stitched = stitchSections(parsed.sections);
    expect(stitched).toBe(MULTI_SECTION_ARTICLE);
  });

  it('handles empty sections array', () => {
    expect(stitchSections([])).toBe('');
  });
});

describe('stitchWithReplacements', () => {
  it('replaces a single section while preserving others', () => {
    const parsed = parseArticleIntoSections(MULTI_SECTION_ARTICLE);

    const replacementMarkdown = `## Second Section

This section has been improved with better prose. It now provides deeper analysis of the topic.
`;
    const replacements = new Map([[2, replacementMarkdown]]);
    const result = stitchWithReplacements(parsed, replacements);

    // Should contain the replacement
    expect(result).toContain('This section has been improved');
    // Should preserve other sections
    expect(result).toContain('# Great Article Title');
    expect(result).toContain('## First Section');
    expect(result).toContain('## Third Section');
    // Should NOT contain original second section text
    expect(result).not.toContain('Another section with more prose');
  });

  it('replaces multiple sections simultaneously', () => {
    const parsed = parseArticleIntoSections(MULTI_SECTION_ARTICLE);

    const replacement1 = `## First Section

Improved first section content here. It now explains fundamentals more clearly.
`;
    const replacement3 = `## Third Section

Improved conclusion with stronger closing statements. It ties everything together effectively.
`;
    const replacements = new Map([
      [1, replacement1],
      [3, replacement3],
    ]);
    const result = stitchWithReplacements(parsed, replacements);

    expect(result).toContain('Improved first section content');
    expect(result).toContain('Improved conclusion with stronger');
    // Original second section preserved
    expect(result).toContain('Another section with more prose');
  });

  it('returns original when replacement map is empty', () => {
    const parsed = parseArticleIntoSections(MULTI_SECTION_ARTICLE);
    const result = stitchWithReplacements(parsed, new Map());
    expect(result).toBe(MULTI_SECTION_ARTICLE);
  });

  it('stitched output with valid replacements passes validateFormat', () => {
    const parsed = parseArticleIntoSections(MULTI_SECTION_ARTICLE);

    const replacement = `## Second Section

This replacement section has proper paragraph structure. It maintains the multi-sentence paragraph requirement.

Additional paragraph here provides more depth. It ensures the format validator won't complain about short paragraphs.
`;
    const replacements = new Map([[2, replacement]]);
    const result = stitchWithReplacements(parsed, replacements);
    const formatResult = validateFormat(result);
    expect(formatResult.valid).toBe(true);
  });

  it('round-trip: parse → stitch passes validateFormat for valid input', () => {
    const parsed = parseArticleIntoSections(MULTI_SECTION_ARTICLE);
    const stitched = stitchSections(parsed.sections);
    const formatResult = validateFormat(stitched);
    expect(formatResult.valid).toBe(true);
  });
});
