/**
 * Fixture-based tests for RenderCriticMarkupFromMDAstDiff (Step 3)
 * Tests the deterministic diff algorithm with comprehensive fixtures
 *
 * NOTE: Tests requiring real markdown parsing (unified/remark-parse) have been
 * migrated to markdownASTdiff.esm.test.ts which runs via `npm run test:esm`.
 *
 * This file contains:
 * - Behavior verification tests using mock AST (Jest-compatible)
 *
 * For full fixture tests with real parsing, run:
 *   npm run test:esm
 */

import { RenderCriticMarkupFromMDAstDiff } from './markdownASTdiff';
import {
  hasCriticInsertion,
  hasCriticDeletion,
  createMockRoot,
  createMockParagraph,
  createMockHeading,
  createMockCodeBlock,
  createMockList,
  createMockListItem,
} from '@/testing/utils/editor-test-helpers';

// Suppress console logs during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

/**
 * Create a simple AST from markdown text
 * This simulates what unified().use(remarkParse).parse() produces
 * for simple paragraph content
 */
function createSimpleAST(markdown: string) {
  // Handle empty markdown
  if (!markdown.trim()) {
    return createMockRoot([]);
  }

  // Split by double newlines to get paragraphs
  const paragraphs = markdown.split(/\n\n+/).filter(p => p.trim());

  const children = paragraphs.map(p => {
    // Check if it's a heading
    const headingMatch = p.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      return createMockHeading(headingMatch[1].length, headingMatch[2]);
    }

    // Check if it's a code block
    const codeMatch = p.match(/^```(\w*)\n([\s\S]*?)```$/);
    if (codeMatch) {
      return createMockCodeBlock(codeMatch[2], codeMatch[1] || null);
    }

    // Check if it's a list
    if (p.match(/^[\-\*]\s+/m)) {
      const items = p.split(/\n/).filter(line => line.match(/^[\-\*]\s+/));
      return createMockList(
        items.map(item => createMockListItem(item.replace(/^[\-\*]\s+/, ''))),
        false
      );
    }

    // Default: paragraph
    return createMockParagraph(p);
  });

  return createMockRoot(children);
}

/**
 * Run Step 3: Generate CriticMarkup from AST diff
 */
function runStep3(original: string, edited: string): string {
  const beforeAST = createSimpleAST(original);
  const afterAST = createSimpleAST(edited);
  return RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);
}

// ============= Behavior Verification Tests =============
// These tests use mock AST and work with Jest.
// For comprehensive fixture tests with real parsing, see:
//   markdownASTdiff.esm.test.ts (run via `npm run test:esm`)

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
