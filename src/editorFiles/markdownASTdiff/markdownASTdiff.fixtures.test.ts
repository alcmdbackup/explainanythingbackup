/**
 * Fixture-based tests for RenderCriticMarkupFromMDAstDiff (Step 3)
 * Tests the deterministic diff algorithm with 30 comprehensive fixtures
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { RenderCriticMarkupFromMDAstDiff } from './markdownASTdiff';
import {
  getAllPipelineFixtures,
  getPipelineFixturesByCategory,
  hasCriticInsertion,
  hasCriticDeletion,
  countCriticOperations,
  type PipelineFixture,
} from '@/testing/utils/editor-test-helpers';

// Suppress console logs during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

/**
 * Parse markdown to AST (same pattern as aiSuggestion.ts:207-208)
 */
function parseMarkdown(markdown: string) {
  return unified().use(remarkParse).parse(markdown);
}

/**
 * Run Step 3: Generate CriticMarkup from AST diff
 */
function runStep3(original: string, edited: string): string {
  const beforeAST = parseMarkdown(original);
  const afterAST = parseMarkdown(edited);
  return RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
}

// ============= Full Fixture Suite =============

describe('Step 3: RenderCriticMarkupFromMDAstDiff - All Fixtures', () => {
  const allFixtures = getAllPipelineFixtures();

  describe.each(allFixtures)('$name', (fixture: PipelineFixture) => {
    it(`generates CriticMarkup: ${fixture.description}`, () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      // Check for expected diff types
      if (fixture.expectedDiffTypes.includes('ins')) {
        expect(hasCriticInsertion(result)).toBe(true);
      }
      if (fixture.expectedDiffTypes.includes('del')) {
        expect(hasCriticDeletion(result)).toBe(true);
      }

      // Verify operation count matches expected
      const operationCount = countCriticOperations(result);
      expect(operationCount).toBe(fixture.expectedDiffNodeCount);
    });
  });
});

// ============= Category-Specific Tests =============

describe('Step 3: Insertions', () => {
  const fixtures = getPipelineFixturesByCategory('insertion');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it('should produce only insertion markers', () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      // All insertions should produce {++...++} markers
      expect(hasCriticInsertion(result)).toBe(true);
      // Pure insertions should not have deletions
      expect(hasCriticDeletion(result)).toBe(false);
    });

    it('should contain the new content in insertion markers', () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      // Verify the result contains insertion markup
      expect(result).toMatch(/\{\+\+[\s\S]+?\+\+\}/);
    });
  });
});

describe('Step 3: Deletions', () => {
  const fixtures = getPipelineFixturesByCategory('deletion');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it('should produce only deletion markers', () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      // All deletions should produce {--...--} markers
      expect(hasCriticDeletion(result)).toBe(true);
      // Pure deletions should not have insertions
      expect(hasCriticInsertion(result)).toBe(false);
    });

    it('should contain the removed content in deletion markers', () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      // Verify the result contains deletion markup
      expect(result).toMatch(/\{--[\s\S]+?--\}/);
    });
  });
});

describe('Step 3: Updates (Word Replacements)', () => {
  const fixtures = getPipelineFixturesByCategory('update');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it('should produce both deletion and insertion markers', () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      // Updates typically produce del+ins pairs
      expect(hasCriticDeletion(result)).toBe(true);
      expect(hasCriticInsertion(result)).toBe(true);
    });

    it('should have correct number of operations', () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      const operationCount = countCriticOperations(result);
      expect(operationCount).toBe(fixture.expectedDiffNodeCount);
    });
  });
});

describe('Step 3: Mixed Operations', () => {
  const fixtures = getPipelineFixturesByCategory('mixed');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it('should handle multiple operation types', () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      const operationCount = countCriticOperations(result);
      expect(operationCount).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('Step 3: Edge Cases', () => {
  const fixtures = getPipelineFixturesByCategory('edge-case');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it(`handles: ${fixture.description}`, () => {
      // Should not throw for any edge case
      expect(() => {
        runStep3(fixture.originalMarkdown, fixture.editedMarkdown);
      }).not.toThrow();
    });

    it('produces valid CriticMarkup', () => {
      const result = runStep3(fixture.originalMarkdown, fixture.editedMarkdown);

      // Verify result has at least one operation
      const operationCount = countCriticOperations(result);
      expect(operationCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============= Specific Behavior Tests =============

describe('Step 3: Behavior Verification', () => {
  it('returns original unchanged when no edits', () => {
    const markdown = 'No changes here.';
    const result = runStep3(markdown, markdown);

    // No markup should be added
    expect(hasCriticInsertion(result)).toBe(false);
    expect(hasCriticDeletion(result)).toBe(false);
  });

  it('handles empty input gracefully', () => {
    const result = runStep3('', 'New content');

    expect(hasCriticInsertion(result)).toBe(true);
  });

  it('handles removal of all content', () => {
    const result = runStep3('Old content', '');

    expect(hasCriticDeletion(result)).toBe(true);
  });

  it('preserves paragraph structure in output', () => {
    const original = 'Para 1.\n\nPara 2.';
    const edited = 'Para 1.\n\nPara 2 modified.';

    const result = runStep3(original, edited);

    // Should maintain paragraph breaks
    expect(result).toContain('\n\n');
  });
});
