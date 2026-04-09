// Property-based tests for format validation functions — idempotency, invariants, and edge cases.

import * as fc from 'fast-check';
import {
  stripCodeBlocks,
  extractParagraphs,
  validateFormat,
  hasBulletPoints,
  hasNumberedLists,
  hasTables,
} from './enforceVariantFormat';

describe('enforceVariantFormat property tests', () => {
  describe('stripCodeBlocks', () => {
    it('is idempotent: stripping twice equals stripping once', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), (text) => {
          const once = stripCodeBlocks(text);
          const twice = stripCodeBlocks(once);
          expect(twice).toBe(once);
        }),
        { numRuns: 200 },
      );
    });

    it('non-code text is unchanged', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 200 }).filter((s) => !s.includes('```')),
          (text) => {
            expect(stripCodeBlocks(text)).toBe(text);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('output never contains triple backtick fences', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 500 }), (text) => {
          const result = stripCodeBlocks(text);
          // After stripping, no complete fenced code blocks should remain
          expect(result).not.toMatch(/```[\s\S]*?```/);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe('validateFormat', () => {
    it('empty text is always invalid', () => {
      const result = validateFormat('');
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('Empty text');
    });

    it('whitespace-only text is invalid', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 20 }),
          (whitespace) => {
            const result = validateFormat(whitespace);
            expect(result.valid).toBe(false);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('valid article format passes validation', () => {
      const validArticle = `# Test Article Title

## Introduction

This is a well-formed paragraph with multiple sentences. It has at least two sentences here.

## Details

Another paragraph that explains more details. This section provides additional context and information.

## Conclusion

The final paragraph wraps up the article. It summarizes the key points discussed above.`;

      const result = validateFormat(validArticle);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('bullets detected outside code blocks', () => {
      const textWithBullets = `# Title

## Section

- bullet one
- bullet two

A paragraph with two sentences. This is the second.`;

      const result = validateFormat(textWithBullets);
      expect(result.issues).toContain('Contains bullet points');
    });

    it('bullets inside code blocks are not detected', () => {
      const textWithCodeBullets = `# Title

## Section

This is a normal paragraph here. It explains something important.

\`\`\`
- this is inside code
- not a bullet
\`\`\`

Another paragraph that continues the discussion. It also has multiple sentences.`;

      const result = validateFormat(textWithCodeBullets);
      expect(result.issues).not.toContain('Contains bullet points');
    });
  });

  describe('extractParagraphs', () => {
    it('never includes headings', () => {
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom('# Title', '## Heading', '### Sub', 'Normal text.', 'Another para.'), {
            minLength: 1,
            maxLength: 10,
          }),
          (lines) => {
            const text = lines.join('\n\n');
            const paragraphs = extractParagraphs(text);
            for (const p of paragraphs) {
              expect(p.startsWith('#')).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('no empty blocks in output', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 300 }), (text) => {
          const paragraphs = extractParagraphs(text);
          for (const p of paragraphs) {
            expect(p.length).toBeGreaterThan(0);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('no label lines (ending with colon) in output', () => {
      const text = `# Title

Some label:

A real paragraph with two sentences. Second sentence here.

Another label:

Final paragraph with content. Also multiple sentences.`;
      const paragraphs = extractParagraphs(text);
      for (const p of paragraphs) {
        expect(p.trim().endsWith(':')).toBe(false);
      }
    });
  });

  describe('detection helpers', () => {
    it('hasBulletPoints detects dash bullets', () => {
      expect(hasBulletPoints('- item')).toBe(true);
      expect(hasBulletPoints('* item')).toBe(true);
      expect(hasBulletPoints('+ item')).toBe(true);
    });

    it('hasNumberedLists detects numbered items', () => {
      expect(hasNumberedLists('1. item')).toBe(true);
      expect(hasNumberedLists('2) item')).toBe(true);
    });

    it('hasTables detects pipe tables', () => {
      expect(hasTables('| col1 | col2 |')).toBe(true);
      expect(hasTables('no table here')).toBe(false);
    });
  });
});
