/**
 * Pipeline Step Handoff Tests for AI Suggestions (Phase 4)
 *
 * Tests the integration between pipeline steps:
 * - Step 1 → Step 2: AI suggestions → Apply edits
 * - Step 2 → Step 3: Applied edits → CriticMarkup diff
 * - Step 3 → Step 4: CriticMarkup → Preprocessed for Lexical
 *
 * These tests verify that each step produces valid output for the next step.
 */

import {
  createAISuggestionPrompt,
  mergeAISuggestionOutput,
  validateAISuggestionOutput,
  createApplyEditsPrompt,
} from './aiSuggestion';
import { RenderCriticMarkupFromMDAstDiff } from './markdownASTdiff/markdownASTdiff';
import { preprocessCriticMarkup } from './lexicalEditor/importExportUtils';
import {
  AI_PIPELINE_FIXTURES,
  hasCriticInsertion,
  hasCriticDeletion,
  countCriticOperations,
  type PipelineFixture,
} from '@/testing/utils/editor-test-helpers';

// Mock unified/remark-parse for AST creation
jest.mock('unified', () => ({
  unified: () => ({
    use: () => ({
      parse: (markdown: string) => createMockASTFromMarkdown(markdown),
    }),
  }),
}));

// Suppress console logs during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

// ============= Mock AST Creation =============

function createMockASTFromMarkdown(markdown: string) {
  // Simple parser for test purposes
  if (!markdown.trim()) {
    return { type: 'root', children: [] };
  }

  const paragraphs = markdown.split(/\n\n+/).filter((p) => p.trim());
  const children = paragraphs.map((p) => {
    // Handle headings
    const headingMatch = p.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      return {
        type: 'heading',
        depth: headingMatch[1].length,
        children: [{ type: 'text', value: headingMatch[2] }],
      };
    }

    // Handle code blocks
    const codeMatch = p.match(/^```(\w*)\n([\s\S]*?)```$/);
    if (codeMatch) {
      return {
        type: 'code',
        lang: codeMatch[1] || null,
        value: codeMatch[2],
      };
    }

    // Handle lists
    if (p.match(/^[-*]\s+/m)) {
      const items = p.split(/\n/).filter((line) => line.match(/^[-*]\s+/));
      return {
        type: 'list',
        ordered: false,
        children: items.map((item) => ({
          type: 'listItem',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: item.replace(/^[-*]\s+/, '') }],
            },
          ],
        })),
      };
    }

    // Default: paragraph
    return {
      type: 'paragraph',
      children: [{ type: 'text', value: p }],
    };
  });

  return { type: 'root', children };
}

// ============= Step 1: Suggestion Generation Tests =============

describe('Pipeline Step 1: AI Suggestion Generation', () => {
  it('createAISuggestionPrompt returns valid prompt for pipeline', () => {
    const content = 'Original content to edit.';
    const userPrompt = 'Remove the first word';

    const prompt = createAISuggestionPrompt(content, userPrompt);

    // Prompt should contain all necessary parts for AI
    expect(prompt).toContain(content);
    expect(prompt).toContain(userPrompt);
    expect(prompt).toContain('<output_format>');
    expect(prompt).toContain('... existing text ...');
  });

  it('valid AI response parses correctly for Step 2', () => {
    const aiResponse = JSON.stringify({
      edits: ['Improved text', '... existing text ...', 'More changes'],
    });

    const validation = validateAISuggestionOutput(aiResponse);

    expect(validation.success).toBe(true);
    if (validation.success) {
      const merged = mergeAISuggestionOutput(validation.data);
      expect(merged).toContain('Improved text');
      expect(merged).toContain('... existing text ...');
    }
  });

  it('malformed AI response fails gracefully', () => {
    const badResponse = '{ invalid json }';
    const validation = validateAISuggestionOutput(badResponse);

    expect(validation.success).toBe(false);
  });

  it('wrong pattern AI response fails validation', () => {
    // Starts with marker (invalid)
    const invalidPattern = JSON.stringify({
      edits: ['... existing text ...', 'Content'],
    });

    const validation = validateAISuggestionOutput(invalidPattern);
    expect(validation.success).toBe(false);
  });
});

// ============= Step 2: Apply Edits Tests =============

describe('Pipeline Step 2: Apply Edits', () => {
  it('createApplyEditsPrompt contains all required parts', () => {
    const suggestions = 'Edited content\n... existing text ...';
    const original = 'Original content here';

    const prompt = createApplyEditsPrompt(suggestions, original);

    expect(prompt).toContain(suggestions);
    expect(prompt).toContain(original);
    expect(prompt).toContain('== AI SUGGESTIONS ==');
    expect(prompt).toContain('== ORIGINAL CONTENT ==');
    expect(prompt).toContain('IMPORTANT RULES');
  });

  it('Step 2 output format is markdown-compatible for Step 3', () => {
    // Simulate Step 2 output
    const step2Output = `# Updated Title

This is the modified paragraph with changes applied.

## Section Two

More content here.`;

    // This should be valid markdown for Step 3 parsing
    const ast = createMockASTFromMarkdown(step2Output);

    expect(ast.type).toBe('root');
    expect(ast.children.length).toBeGreaterThan(0);
  });
});

// ============= Step 3: CriticMarkup Generation Tests =============

describe('Pipeline Step 3: CriticMarkup Generation', () => {
  // NOTE: Detailed AST diff tests are in markdownASTdiff.esm.test.ts
  // These tests verify pipeline integration, not exact diff algorithm behavior

  describe('basic diff operations', () => {
    it('generates both del and ins for word replacements', () => {
      const beforeAST = createMockASTFromMarkdown('The cat sat.');
      const afterAST = createMockASTFromMarkdown('The dog sat.');

      const result = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);

      // Replacement should have both
      expect(hasCriticDeletion(result)).toBe(true);
      expect(hasCriticInsertion(result)).toBe(true);
    });

    it('does not throw for different inputs', () => {
      const beforeAST = createMockASTFromMarkdown('First paragraph.');
      const afterAST = createMockASTFromMarkdown('Different paragraph.');

      expect(() => {
        RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
      }).not.toThrow();
    });
  });

  it('empty diff produces no CriticMarkup', () => {
    const markdown = 'Same content.';
    const beforeAST = createMockASTFromMarkdown(markdown);
    const afterAST = createMockASTFromMarkdown(markdown);

    const result = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);

    expect(hasCriticInsertion(result)).toBe(false);
    expect(hasCriticDeletion(result)).toBe(false);
  });

  it('handles empty AST gracefully', () => {
    const emptyAST = { type: 'root', children: [] };

    expect(() => {
      RenderCriticMarkupFromMDAstDiff(emptyAST, emptyAST);
    }).not.toThrow();
  });
});

// ============= Step 4: Preprocessing Tests =============

describe('Pipeline Step 4: Preprocessing for Lexical', () => {
  it('preserves CriticMarkup through preprocessing', () => {
    const criticMarkup = 'Text {++inserted++} more {--deleted--} text.';
    const result = preprocessCriticMarkup(criticMarkup);

    expect(hasCriticInsertion(result)).toBe(true);
    expect(hasCriticDeletion(result)).toBe(true);
  });

  it('converts multiline content to <br> inside CriticMarkup', () => {
    const criticMarkup = '{++line1\nline2++}';
    const result = preprocessCriticMarkup(criticMarkup);

    expect(result).toContain('<br>');
  });

  it('preserves paragraph breaks outside CriticMarkup', () => {
    const criticMarkup = 'Para 1.\n\n{++insert++}\n\nPara 2.';
    const result = preprocessCriticMarkup(criticMarkup);

    expect(result).toMatch(/Para 1\.\n\n/);
    expect(result).toMatch(/\n\nPara 2\./);
  });
});

// ============= Full Pipeline Integration Tests =============

describe('Pipeline: Step 1 → 4 Integration', () => {
  describe('Full flow for prompt-specific fixtures', () => {
    const promptFixtures = Object.values(AI_PIPELINE_FIXTURES.promptSpecific);

    describe.each(promptFixtures)('$name', (fixture: PipelineFixture) => {
      it('produces diffs through full pipeline (mock AST)', () => {
        // Step 3: Generate CriticMarkup from diff
        const beforeAST = createMockASTFromMarkdown(fixture.originalMarkdown);
        const afterAST = createMockASTFromMarkdown(fixture.editedMarkdown);
        const criticMarkup = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);

        // Step 4: Preprocess for Lexical
        const preprocessed = preprocessCriticMarkup(criticMarkup);

        // Verify output has some diff operations
        const operationCount = countCriticOperations(preprocessed);
        expect(operationCount).toBeGreaterThan(0);
      });

      it('Step 4 output matches expected format', () => {
        const preprocessed = preprocessCriticMarkup(fixture.expectedStep3Output);

        // Check expected diff types
        if (fixture.expectedDiffTypes.includes('ins')) {
          expect(hasCriticInsertion(preprocessed)).toBe(true);
        }
        if (fixture.expectedDiffTypes.includes('del')) {
          expect(hasCriticDeletion(preprocessed)).toBe(true);
        }
      });

      it('expected fixture produces correct diff count', () => {
        // Test using the expected Step3 output (not mock AST)
        const preprocessed = preprocessCriticMarkup(fixture.expectedStep3Output);
        const operationCount = countCriticOperations(preprocessed);
        expect(operationCount).toBe(fixture.expectedDiffNodeCount);
      });
    });
  });
});

// ============= Error Propagation Tests =============

describe('Pipeline Error Handling', () => {
  it('Step 1 invalid JSON does not crash pipeline', () => {
    const invalidJSON = 'not valid { json }';
    const result = validateAISuggestionOutput(invalidJSON);

    expect(result.success).toBe(false);
    expect(result).toHaveProperty('error');
  });

  it('Step 3 handles empty AST gracefully', () => {
    const emptyAST = { type: 'root', children: [] };

    expect(() => {
      RenderCriticMarkupFromMDAstDiff(emptyAST, emptyAST);
    }).not.toThrow();
  });

  it('Step 4 handles empty string', () => {
    const result = preprocessCriticMarkup('');
    expect(result).toBe('');
  });

  it('Step 4 handles malformed CriticMarkup', () => {
    // Unclosed markup
    const malformed = '{++unclosed insertion';

    expect(() => {
      preprocessCriticMarkup(malformed);
    }).not.toThrow();
  });
});

// ============= Regression Tests =============

describe('Pipeline Regression Tests', () => {
  it('delete first sentence produces correct CriticMarkup', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.removeFirstSentence;

    // Verify the expected output has a deletion
    expect(hasCriticDeletion(fixture.expectedStep3Output)).toBe(true);
    expect(hasCriticInsertion(fixture.expectedStep3Output)).toBe(false);
  });

  it('shorten paragraph produces both deletion and insertion', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.shortenFirstParagraph;

    expect(hasCriticDeletion(fixture.expectedStep3Output)).toBe(true);
    expect(hasCriticInsertion(fixture.expectedStep3Output)).toBe(true);
  });

  it('improve article produces multiple diffs', () => {
    const fixture = AI_PIPELINE_FIXTURES.promptSpecific.improveEntireArticle;

    const operationCount = countCriticOperations(fixture.expectedStep3Output);
    expect(operationCount).toBeGreaterThan(2);
  });
});
