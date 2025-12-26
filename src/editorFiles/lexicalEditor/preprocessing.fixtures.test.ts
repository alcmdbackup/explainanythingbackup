/**
 * Fixture-based tests for preprocessCriticMarkup (Step 4)
 * Tests the preprocessing of CriticMarkup before Lexical import
 */

import { preprocessCriticMarkup } from './importExportUtils';
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

// ============= Full Fixture Suite =============

describe('Step 4: preprocessCriticMarkup - All Fixtures', () => {
  const allFixtures = getAllPipelineFixtures();

  describe.each(allFixtures)('$name', (fixture: PipelineFixture) => {
    it(`preprocesses correctly: ${fixture.description}`, () => {
      const result = preprocessCriticMarkup(fixture.expectedStep3Output);

      // Verify the preprocessing produces valid output
      expect(typeof result).toBe('string');

      // Check that CriticMarkup is preserved
      if (fixture.expectedDiffTypes.includes('ins')) {
        expect(hasCriticInsertion(result)).toBe(true);
      }
      if (fixture.expectedDiffTypes.includes('del')) {
        expect(hasCriticDeletion(result)).toBe(true);
      }

      // Operation count should be preserved through preprocessing
      const operationCount = countCriticOperations(result);
      expect(operationCount).toBe(fixture.expectedDiffNodeCount);
    });
  });
});

// ============= Category-Specific Tests =============

describe('Step 4: Insertions Preprocessing', () => {
  const fixtures = getPipelineFixturesByCategory('insertion');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it('preserves insertion markers through preprocessing', () => {
      const result = preprocessCriticMarkup(fixture.expectedStep3Output);

      expect(hasCriticInsertion(result)).toBe(true);
      expect(hasCriticDeletion(result)).toBe(false);
    });
  });
});

describe('Step 4: Deletions Preprocessing', () => {
  const fixtures = getPipelineFixturesByCategory('deletion');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it('preserves deletion markers through preprocessing', () => {
      const result = preprocessCriticMarkup(fixture.expectedStep3Output);

      expect(hasCriticDeletion(result)).toBe(true);
      expect(hasCriticInsertion(result)).toBe(false);
    });
  });
});

describe('Step 4: Updates Preprocessing', () => {
  const fixtures = getPipelineFixturesByCategory('update');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it('preserves update markers through preprocessing', () => {
      const result = preprocessCriticMarkup(fixture.expectedStep3Output);

      expect(hasCriticDeletion(result)).toBe(true);
      expect(hasCriticInsertion(result)).toBe(true);
    });
  });
});

describe('Step 4: Mixed Operations Preprocessing', () => {
  const fixtures = getPipelineFixturesByCategory('mixed');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it('handles multiple operation types', () => {
      const result = preprocessCriticMarkup(fixture.expectedStep3Output);

      const operationCount = countCriticOperations(result);
      expect(operationCount).toBe(fixture.expectedDiffNodeCount);
    });
  });
});

describe('Step 4: Edge Cases Preprocessing', () => {
  const fixtures = getPipelineFixturesByCategory('edge-case');

  describe.each(fixtures)('$name', (fixture: PipelineFixture) => {
    it(`handles: ${fixture.description}`, () => {
      // Should not throw for any edge case
      expect(() => {
        preprocessCriticMarkup(fixture.expectedStep3Output);
      }).not.toThrow();
    });
  });
});

// ============= Multiline Normalization Tests =============

describe('Step 4: Multiline Normalization', () => {
  it('converts newlines to <br> inside CriticMarkup insertions', () => {
    const input = '{++line1\nline2++}';
    const result = preprocessCriticMarkup(input);

    expect(result).toContain('<br>');
    expect(result).not.toContain('\n');
  });

  it('converts newlines to <br> inside CriticMarkup deletions', () => {
    const input = '{--line1\nline2--}';
    const result = preprocessCriticMarkup(input);

    expect(result).toContain('<br>');
  });

  it('preserves newlines outside CriticMarkup', () => {
    const input = 'Para 1.\n\n{++insertion++}\n\nPara 2.';
    const result = preprocessCriticMarkup(input);

    // Paragraph breaks outside markup should remain
    expect(result).toMatch(/Para 1\.\n\n/);
  });

  it('handles multiple multiline patterns', () => {
    const input = '{++first\nline++} and {--second\nline--}';
    const result = preprocessCriticMarkup(input);

    // Both patterns should have <br> conversions
    const brCount = (result.match(/<br>/g) || []).length;
    expect(brCount).toBeGreaterThanOrEqual(2);
  });
});

// ============= Heading Formatting Tests =============

describe('Step 4: Heading Formatting', () => {
  it('ensures headings start on newline', () => {
    const input = 'Text # Heading';
    const result = preprocessCriticMarkup(input);

    // Heading should be on its own line
    expect(result).toMatch(/\n# Heading/);
  });

  it('preserves properly formatted headings', () => {
    const input = 'Text\n\n# Heading';
    const result = preprocessCriticMarkup(input);

    expect(result).toContain('\n\n# Heading');
  });

  it('handles headings inside CriticMarkup', () => {
    const input = '{++# New Heading++}';
    const result = preprocessCriticMarkup(input);

    // CriticMarkup containing heading should be preserved
    expect(result).toContain('# New Heading');
  });
});

// ============= Idempotency Tests =============

describe('Step 4: Idempotency', () => {
  it('produces same result when applied twice', () => {
    const input = 'Text {++inserted++} more text.';
    const result1 = preprocessCriticMarkup(input);
    const result2 = preprocessCriticMarkup(result1);

    expect(result1).toBe(result2);
  });

  it('handles already normalized content', () => {
    const input = 'Already {++clean++} content.';
    const result = preprocessCriticMarkup(input);

    // Should not alter already clean content
    expect(result).toBe(input);
  });
});

// ============= Edge Cases =============

describe('Step 4: Specific Edge Cases', () => {
  it('handles empty string', () => {
    const result = preprocessCriticMarkup('');
    expect(result).toBe('');
  });

  it('handles string with no CriticMarkup', () => {
    const input = 'Plain text without any markup.';
    const result = preprocessCriticMarkup(input);

    expect(result).toBe(input);
  });

  it('handles nested patterns gracefully', () => {
    // This tests edge case where {} might appear inside markup
    const input = '{++code with {curly} braces++}';
    const result = preprocessCriticMarkup(input);

    // Should not break on nested braces
    expect(hasCriticInsertion(result)).toBe(true);
  });

  it('handles unicode content', () => {
    const input = '{++emoji 🎉 and unicode++}';
    const result = preprocessCriticMarkup(input);

    expect(result).toContain('🎉');
  });

  it('handles very long content', () => {
    const longText = 'A '.repeat(1000);
    const input = `{++${longText}++}`;
    const result = preprocessCriticMarkup(input);

    expect(hasCriticInsertion(result)).toBe(true);
  });
});
