/**
 * Tests for importExportUtils.ts (Phase 7B)
 * Tests markdown import/export, CriticMarkup transformers, and node promotion logic
 */

import { createEditor, LexicalEditor, $getRoot, $createParagraphNode, $createTextNode, $isElementNode, $isTextNode } from 'lexical';
import { $convertFromMarkdownString, $convertToMarkdownString } from '@lexical/markdown';
import { HeadingNode, $isHeadingNode, $createHeadingNode } from '@lexical/rich-text';
import { LinkNode } from '@lexical/link';
import { CodeNode } from '@lexical/code';
import { ListNode, ListItemNode } from '@lexical/list';
import {
  CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER,
  CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER,
  DIFF_TAG_EXPORT_TRANSFORMER,
  STANDALONE_TITLE_LINK_TRANSFORMER,
  MARKDOWN_TRANSFORMERS,
  preprocessCriticMarkup,
  promoteNodesAfterImport,
  replaceDiffTagNodes,
  replaceDiffTagNodesAndExportMarkdown,
  exportMarkdownReadOnly,
  removeTrailingBreaksFromTextNodes,
  replaceBrTagsWithNewlines,
} from './importExportUtils';
import {
  DiffTagNodeInline,
  $createDiffTagNodeInline,
  $isDiffTagNodeInline,
  DiffUpdateContainerInline,
  $isDiffUpdateContainerInline,
} from './DiffTagNode';
import {
  StandaloneTitleLinkNode,
  $createStandaloneTitleLinkNode,
  $isStandaloneTitleLinkNode,
} from './StandaloneTitleLinkNode';

// ============= Test Helpers =============

/**
 * Creates a Lexical editor instance for testing
 */
function createTestEditor(): LexicalEditor {
  return createEditor({
    nodes: [
      HeadingNode,
      DiffTagNodeInline,
      DiffUpdateContainerInline,
      StandaloneTitleLinkNode,
      LinkNode,
      CodeNode,
      ListNode,
      ListItemNode,
    ],
    onError: (error) => {
      throw error;
    },
  });
}

/**
 * Helper to execute code in editor update and return a value
 */
async function editorUpdate<T>(editor: LexicalEditor, fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    editor.update(
      () => {
        try {
          const result = fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      },
      { discrete: true }
    );
  });
}

/**
 * Helper to read editor state
 */
async function editorRead<T>(editor: LexicalEditor, fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    editor.getEditorState().read(() => {
      try {
        const result = fn();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Helper to get text content from editor
 */
async function getEditorText(editor: LexicalEditor): Promise<string> {
  return editorRead(editor, () => {
    const root = $getRoot();
    return root.getTextContent();
  });
}

/**
 * Helper to count nodes of a specific type
 */
async function countNodesOfType(editor: LexicalEditor, typeName: string): Promise<number> {
  return editorRead(editor, () => {
    const root = $getRoot();
    let count = 0;

    function traverse(node: any): void {
      if (node.getType() === typeName) {
        count++;
      }
      if ($isElementNode(node)) {
        node.getChildren().forEach(traverse);
      }
    }

    root.getChildren().forEach(traverse);
    return count;
  });
}

// ============= Test Suites =============

describe('importExportUtils - Preprocessing Functions', () => {
  describe('preprocessCriticMarkup', () => {
    it('should normalize single-line CriticMarkup (no changes needed)', () => {
      const input = '{++inserted text++}';
      const result = preprocessCriticMarkup(input);
      expect(result).toContain('{++');
      expect(result).toContain('++}');
    });

    it('should normalize multiline CriticMarkup by replacing newlines with <br>', () => {
      const input = '{++line one\nline two++}';
      const result = preprocessCriticMarkup(input);
      expect(result).toContain('<br>');
      expect(result).not.toContain('\n{++');
    });

    it('should handle deletion CriticMarkup', () => {
      const input = '{--deleted text--}';
      const result = preprocessCriticMarkup(input);
      expect(result).toContain('{--');
      expect(result).toContain('--}');
    });

    it('should handle substitution CriticMarkup', () => {
      const input = '{~~old text~>new text~~}';
      const result = preprocessCriticMarkup(input);
      expect(result).toContain('{~~');
      expect(result).toContain('~>');
      expect(result).toContain('~~}');
    });

    it('should fix heading formatting by adding newlines before headings', () => {
      const input = 'Some text# Heading';
      const result = preprocessCriticMarkup(input);
      expect(result).toMatch(/Some text\n# Heading/);
    });

    it('should not modify headings already on their own line', () => {
      const input = 'Some text\n# Heading';
      const result = preprocessCriticMarkup(input);
      expect(result).toBe(input);
    });

    it('should handle complex multiline CriticMarkup with substitutions', () => {
      const input = '{~~old line one\nold line two~>new line one\nnew line two~~}';
      const result = preprocessCriticMarkup(input);
      expect(result).toContain('<br>');
      expect(result).toContain('~>');
    });

    it('should handle empty CriticMarkup', () => {
      const input = '{++++}';
      const result = preprocessCriticMarkup(input);
      expect(result).toContain('{++');
      expect(result).toContain('++}');
    });

    it('should preserve text outside CriticMarkup', () => {
      const input = 'Before {++inserted++} After';
      const result = preprocessCriticMarkup(input);
      expect(result).toContain('Before');
      expect(result).toContain('After');
    });

    it('should handle multiple CriticMarkup blocks', () => {
      const input = '{++first++} text {--second--}';
      const result = preprocessCriticMarkup(input);
      expect(result).toContain('{++first++}');
      expect(result).toContain('{--second--}');
    });
  });
});

describe('importExportUtils - Inline CriticMarkup Import', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  describe('Insertion syntax {++...++}', () => {
    it('should parse simple insertion CriticMarkup', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++inserted text++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toBe('inserted text');

      const diffCount = await countNodesOfType(editor, 'diff-tag');
      expect(diffCount).toBe(1);
    });

    it('should parse insertion with bold formatting', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++**bold text**++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('bold text');
    });

    it('should parse insertion with italic formatting', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++*italic text*++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('italic text');
    });

    it('should parse insertion with inline code', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++`code block`++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('code block');
    });

    it('should parse insertion with link', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++[link text](https://example.com)++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('link text');
    });

    it('should parse multiple insertions in sequence', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++first++} middle {++second++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('first');
      expect(text).toContain('middle');
      expect(text).toContain('second');

      const diffCount = await countNodesOfType(editor, 'diff-tag');
      expect(diffCount).toBe(2);
    });
  });

  describe('Deletion syntax {--...--}', () => {
    it('should parse simple deletion CriticMarkup', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{--deleted text--}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toBe('deleted text');

      const diffCount = await countNodesOfType(editor, 'diff-tag');
      expect(diffCount).toBe(1);
    });

    it('should parse deletion with formatting', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{--**bold deleted**--}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('bold deleted');
    });

    it('should handle mixed insertions and deletions', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{--old--} {++new++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('old');
      expect(text).toContain('new');

      const diffCount = await countNodesOfType(editor, 'diff-tag');
      expect(diffCount).toBe(2);
    });
  });

  describe('Substitution syntax {~~old~>new~~}', () => {
    it('should parse simple substitution CriticMarkup', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~old text~>new text~~}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('old text');
      expect(text).toContain('new text');

      const diffCount = await countNodesOfType(editor, 'diff-tag');
      expect(diffCount).toBe(1);

      // Check for update containers
      const containerCount = await countNodesOfType(editor, 'diff-update-container-inline');
      expect(containerCount).toBe(2); // before and after containers
    });

    it('should parse substitution with formatting in before text', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~**old bold**~>new text~~}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('old bold');
      expect(text).toContain('new text');
    });

    it('should parse substitution with formatting in after text', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~old text~>**new bold**~~}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('old text');
      expect(text).toContain('new bold');
    });

    it('should parse substitution with formatting in both parts', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~*old italic*~>**new bold**~~}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('old italic');
      expect(text).toContain('new bold');
    });

    it('should handle malformed substitution gracefully', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        // Missing ~> separator - should not crash
        $convertFromMarkdownString('{~~no separator~~}', MARKDOWN_TRANSFORMERS, root);
      });

      // Should not throw, text should be preserved
      const text = await getEditorText(editor);
      expect(text.length).toBeGreaterThan(0);
    });
  });

  describe('Edge cases', () => {
    // TODO: Requires full integration test setup with browser environment
    it.skip('should handle empty CriticMarkup blocks', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++++}', MARKDOWN_TRANSFORMERS, root);
      });

      const diffCount = await countNodesOfType(editor, 'diff-tag');
      expect(diffCount).toBe(1);
    });

    it('should handle nested formatting in CriticMarkup', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++**bold *and italic* text**++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('bold');
      expect(text).toContain('and italic');
    });

    it('should preserve text before CriticMarkup', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('Before {++inserted++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('Before');
      expect(text).toContain('inserted');
    });

    it('should preserve text after CriticMarkup', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++inserted++} After', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('inserted');
      expect(text).toContain('After');
    });

    it('should handle CriticMarkup with special characters', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++special: @#$%^&*()++}', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toContain('special: @#$%^&*()');
    });
  });
});

describe('importExportUtils - Block CriticMarkup Import', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should parse CriticMarkup containing heading', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      $convertFromMarkdownString('{++# Heading++}', MARKDOWN_TRANSFORMERS, root);
    });

    const text = await getEditorText(editor);
    expect(text).toContain('Heading');

    const headingCount = await countNodesOfType(editor, 'heading');
    expect(headingCount).toBeGreaterThanOrEqual(1);
  });

  it('should parse deletion with heading', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      $convertFromMarkdownString('{--## Old Heading--}', MARKDOWN_TRANSFORMERS, root);
    });

    const text = await getEditorText(editor);
    expect(text).toContain('Old Heading');
  });

  it('should parse substitution with headings', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      $convertFromMarkdownString('{~~# Old~># New~~}', MARKDOWN_TRANSFORMERS, root);
    });

    const text = await getEditorText(editor);
    expect(text).toContain('Old');
    expect(text).toContain('New');
  });
});

describe('importExportUtils - Export Functions', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  describe('replaceDiffTagNodesAndExportMarkdown', () => {
    it('should export DiffTagNodeInline as CriticMarkup insertion', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const diff = $createDiffTagNodeInline('ins');
        diff.append($createTextNode('inserted'));
        paragraph.append(diff);
        root.append(paragraph);
      });

      const markdown = await editorUpdate(editor, () => replaceDiffTagNodesAndExportMarkdown());
      expect(markdown).toContain('{++');
      expect(markdown).toContain('++}');
      expect(markdown).toContain('inserted');
    });

    it('should export DiffTagNodeInline as CriticMarkup deletion', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const diff = $createDiffTagNodeInline('del');
        diff.append($createTextNode('deleted'));
        paragraph.append(diff);
        root.append(paragraph);
      });

      const markdown = await editorUpdate(editor, () => replaceDiffTagNodesAndExportMarkdown());
      expect(markdown).toContain('{--');
      expect(markdown).toContain('--}');
      expect(markdown).toContain('deleted');
    });

    // TODO: Update nodes require proper container setup for export
    it.skip('should export DiffTagNodeInline as CriticMarkup substitution', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const diff = $createDiffTagNodeInline('update');
        diff.append($createTextNode('old'));
        diff.append($createTextNode('new'));
        paragraph.append(diff);
        root.append(paragraph);
      });

      const markdown = await editorUpdate(editor, () => replaceDiffTagNodesAndExportMarkdown());
      expect(markdown).toContain('{~~');
      expect(markdown).toContain('~~}');
    });
  });

  describe('exportMarkdownReadOnly', () => {
    it('should export markdown without modifying editor state', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode('Test content'));
        root.append(paragraph);
      });

      const markdown = await editorUpdate(editor, () => exportMarkdownReadOnly());
      expect(markdown).toContain('Test content');

      // Verify editor state unchanged
      const text = await getEditorText(editor);
      expect(text).toBe('Test content');
    });

    it('should export with DiffTagNodes as-is', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const diff = $createDiffTagNodeInline('ins');
        diff.append($createTextNode('inserted'));
        root.append(diff);
      });

      const markdown = await editorUpdate(editor, () => exportMarkdownReadOnly());
      expect(markdown.length).toBeGreaterThan(0);
    });
  });

  describe('replaceDiffTagNodes', () => {
    it('should replace DiffTagNodeInline with text nodes', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const diff = $createDiffTagNodeInline('ins');
        diff.append($createTextNode('content'));
        paragraph.append(diff);
        root.append(paragraph);
      });

      // Count before replacement
      const beforeCount = await countNodesOfType(editor, 'diff-tag');
      expect(beforeCount).toBe(1);

      await editorUpdate(editor, () => replaceDiffTagNodes());

      // Count after replacement - should be 0
      const afterCount = await countNodesOfType(editor, 'diff-tag');
      expect(afterCount).toBe(0);

      // Content should still be present
      const text = await getEditorText(editor);
      expect(text.length).toBeGreaterThan(0);
    });
  });
});

describe('importExportUtils - Cleanup Functions', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  describe('removeTrailingBreaksFromTextNodes', () => {
    it('should remove trailing <br> from paragraph text', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Content<br>');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => removeTrailingBreaksFromTextNodes());

      const text = await getEditorText(editor);
      expect(text).not.toContain('<br>');
      expect(text).toBe('Content');
    });

    it('should remove trailing <br/> variant', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Content<br/>');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => removeTrailingBreaksFromTextNodes());

      const text = await getEditorText(editor);
      expect(text).toBe('Content');
    });

    it('should remove trailing <br /> variant', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Content<br />');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => removeTrailingBreaksFromTextNodes());

      const text = await getEditorText(editor);
      expect(text).toBe('Content');
    });

    it('should remove multiple consecutive trailing <br> tags', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Content<br><br><br>');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => removeTrailingBreaksFromTextNodes());

      const text = await getEditorText(editor);
      expect(text).toBe('Content');
    });

    it('should not remove <br> in the middle of text', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Line 1<br>Line 2');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => removeTrailingBreaksFromTextNodes());

      const text = await getEditorText(editor);
      expect(text).toContain('<br>');
    });

    it('should handle headings with trailing <br>', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const heading = $createHeadingNode('h1');
        const text = $createTextNode('Heading<br>');
        heading.append(text);
        root.append(heading);
      });

      await editorUpdate(editor, () => removeTrailingBreaksFromTextNodes());

      const text = await getEditorText(editor);
      expect(text).not.toContain('<br>');
    });
  });

  describe('replaceBrTagsWithNewlines', () => {
    it('should replace <br> with newline in paragraphs', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Line 1<br>Line 2');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => replaceBrTagsWithNewlines());

      const text = await getEditorText(editor);
      expect(text).toContain('\n');
      expect(text).not.toContain('<br>');
    });

    it('should delete <br> from headings', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const heading = $createHeadingNode('h1');
        const text = $createTextNode('Heading<br>Text');
        heading.append(text);
        root.append(heading);
      });

      await editorUpdate(editor, () => replaceBrTagsWithNewlines());

      const text = await getEditorText(editor);
      expect(text).not.toContain('<br>');
      expect(text).toBe('HeadingText'); // no newline in headings
    });

    it('should replace multiple consecutive <br> with single newline', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Line 1<br><br><br>Line 2');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => replaceBrTagsWithNewlines());

      const text = await getEditorText(editor);
      // Multiple <br> should become single \n
      expect(text).toMatch(/Line 1\nLine 2/);
    });

    it('should handle <br/> variant', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Line 1<br/>Line 2');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => replaceBrTagsWithNewlines());

      const text = await getEditorText(editor);
      expect(text).toContain('\n');
    });

    it('should handle <br /> variant', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        const paragraph = $createParagraphNode();
        const text = $createTextNode('Line 1<br />Line 2');
        paragraph.append(text);
        root.append(paragraph);
      });

      await editorUpdate(editor, () => replaceBrTagsWithNewlines());

      const text = await getEditorText(editor);
      expect(text).toContain('\n');
    });
  });
});

describe('importExportUtils - Standalone Title Link Transformer', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should parse standalone title link markdown', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      $convertFromMarkdownString('[View Results](/standalone-title?t=test)', MARKDOWN_TRANSFORMERS, root);
    });

    const text = await getEditorText(editor);
    expect(text).toContain('View Results');

    const linkCount = await countNodesOfType(editor, 'standalone-title-link');
    expect(linkCount).toBe(1);
  });

  it('should export standalone title link as plain text (not markdown link)', async () => {
    // Standalone title links should be stripped on export to keep DB content clean
    // Links are re-applied at render time via resolveLinksForDisplayAction
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=encoded');
      link.append($createTextNode('Click Here'));
      paragraph.append(link);
      root.append(paragraph);
    });

    const markdown = await editorUpdate(editor, () => exportMarkdownReadOnly());
    expect(markdown).toContain('Click Here');
    // Should NOT contain markdown link syntax
    expect(markdown).not.toContain('[Click Here]');
    expect(markdown).not.toContain('/standalone-title?t=encoded');
  });

  it('should handle encoded title parameters', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      $convertFromMarkdownString(
        '[Link](/standalone-title?t=My%20Title%20Here)',
        MARKDOWN_TRANSFORMERS,
        root
      );
    });

    const text = await getEditorText(editor);
    expect(text).toContain('Link');
  });
});

describe('importExportUtils - Node Promotion', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should promote heading nodes to top level', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const heading = $createHeadingNode('h1');
      heading.append($createTextNode('Heading'));
      paragraph.append(heading);
      root.append(paragraph);
    });

    await editorUpdate(editor, () => promoteNodesAfterImport());

    // Check that heading is now top-level
    const isTopLevel = await editorRead(editor, () => {
      const root = $getRoot();
      const children = root.getChildren();
      return children.some((child) => $isHeadingNode(child));
    });

    expect(isTopLevel).toBe(true);
  });

  // TODO: Requires integration test - node promotion needs full Lexical lifecycle
  it.skip('should promote DiffTagNodeInline containing headings', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const diff = $createDiffTagNodeInline('ins');
      const heading = $createHeadingNode('h2');
      heading.append($createTextNode('Heading'));
      diff.append(heading);
      paragraph.append(diff);
      root.append(paragraph);
    });

    await editorUpdate(editor, () => promoteNodesAfterImport());

    // Check that diff node is now top-level
    const isTopLevel = await editorRead(editor, () => {
      const root = $getRoot();
      const children = root.getChildren();
      return children.some((child) => $isDiffTagNodeInline(child));
    });

    expect(isTopLevel).toBe(true);
  });

  it('should not promote nodes already at top level', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const heading = $createHeadingNode('h1');
      heading.append($createTextNode('Top Level Heading'));
      root.append(heading);
    });

    await editorUpdate(editor, () => promoteNodesAfterImport());

    // Should still be top level
    const headingCount = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getChildren().filter((child) => $isHeadingNode(child)).length;
    });

    expect(headingCount).toBe(1);
  });

  // TODO: Requires integration test - complex promotion needs full Lexical lifecycle
  it.skip('should handle multiple nodes needing promotion', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();

      const heading1 = $createHeadingNode('h1');
      heading1.append($createTextNode('Heading 1'));
      paragraph.append(heading1);

      const heading2 = $createHeadingNode('h2');
      heading2.append($createTextNode('Heading 2'));
      paragraph.append(heading2);

      root.append(paragraph);
    });

    await editorUpdate(editor, () => promoteNodesAfterImport());

    // Both headings should be promoted
    const headingCount = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getChildren().filter((child) => $isHeadingNode(child)).length;
    });

    expect(headingCount).toBeGreaterThanOrEqual(2);
  });
});

// ============= Transformer Node Type Validation Tests =============
// These tests ensure the transformer creates the correct node types

describe('importExportUtils - Transformer Node Type Validation', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  describe('Insertion creates correct DiffTagNodeInline', () => {
    it('should create DiffTagNodeInline with tag="ins" for insertion', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++inserted text++}', MARKDOWN_TRANSFORMERS, root);
      });

      const nodeInfo = await editorRead(editor, () => {
        const root = $getRoot();
        let foundNode: DiffTagNodeInline | null = null;

        function traverse(node: any): void {
          if ($isDiffTagNodeInline(node)) {
            foundNode = node;
          }
          if ($isElementNode(node)) {
            node.getChildren().forEach(traverse);
          }
        }
        root.getChildren().forEach(traverse);

        if (!foundNode) return null;
        const node = foundNode as DiffTagNodeInline;
        return {
          isCorrectType: $isDiffTagNodeInline(node),
          tag: node.exportJSON().tag,
          textContent: node.getTextContent(),
        };
      });

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.isCorrectType).toBe(true);
      expect(nodeInfo!.tag).toBe('ins');
      expect(nodeInfo!.textContent).toBe('inserted text');
    });

    it('should create DiffTagNodeInline with tag="del" for deletion', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{--deleted text--}', MARKDOWN_TRANSFORMERS, root);
      });

      const nodeInfo = await editorRead(editor, () => {
        const root = $getRoot();
        let foundNode: DiffTagNodeInline | null = null;

        function traverse(node: any): void {
          if ($isDiffTagNodeInline(node)) {
            foundNode = node;
          }
          if ($isElementNode(node)) {
            node.getChildren().forEach(traverse);
          }
        }
        root.getChildren().forEach(traverse);

        if (!foundNode) return null;
        const node = foundNode as DiffTagNodeInline;
        return {
          isCorrectType: $isDiffTagNodeInline(node),
          tag: node.exportJSON().tag,
          textContent: node.getTextContent(),
        };
      });

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.isCorrectType).toBe(true);
      expect(nodeInfo!.tag).toBe('del');
      expect(nodeInfo!.textContent).toBe('deleted text');
    });

    it('should create DiffTagNodeInline with tag="update" for substitution', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~old text~>new text~~}', MARKDOWN_TRANSFORMERS, root);
      });

      const nodeInfo = await editorRead(editor, () => {
        const root = $getRoot();
        let foundNode: DiffTagNodeInline | null = null;

        function traverse(node: any): void {
          if ($isDiffTagNodeInline(node)) {
            foundNode = node;
          }
          if ($isElementNode(node)) {
            node.getChildren().forEach(traverse);
          }
        }
        root.getChildren().forEach(traverse);

        if (!foundNode) return null;
        const node = foundNode as DiffTagNodeInline;
        return {
          isCorrectType: $isDiffTagNodeInline(node),
          tag: node.exportJSON().tag,
        };
      });

      expect(nodeInfo).not.toBeNull();
      expect(nodeInfo!.isCorrectType).toBe(true);
      expect(nodeInfo!.tag).toBe('update');
    });
  });

  describe('Container node creation for updates', () => {
    it('should create two DiffUpdateContainerInline children for substitution', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~before text~>after text~~}', MARKDOWN_TRANSFORMERS, root);
      });

      const containerInfo = await editorRead(editor, () => {
        const root = $getRoot();
        let updateNode: DiffTagNodeInline | null = null;

        function traverse(node: any): void {
          if ($isDiffTagNodeInline(node) && (node as DiffTagNodeInline).exportJSON().tag === 'update') {
            updateNode = node;
          }
          if ($isElementNode(node)) {
            node.getChildren().forEach(traverse);
          }
        }
        root.getChildren().forEach(traverse);

        if (!updateNode) return null;

        const node = updateNode as DiffTagNodeInline;
        const children = node.getChildren();
        const containers = children.filter((child: any) => $isDiffUpdateContainerInline(child));

        return {
          containerCount: containers.length,
          firstContainerType: containers[0]?.exportJSON?.()?.containerType,
          secondContainerType: containers[1]?.exportJSON?.()?.containerType,
          firstContainerText: containers[0]?.getTextContent?.(),
          secondContainerText: containers[1]?.getTextContent?.(),
        };
      });

      expect(containerInfo).not.toBeNull();
      expect(containerInfo!.containerCount).toBe(2);
      expect(containerInfo!.firstContainerType).toBe('before');
      expect(containerInfo!.secondContainerType).toBe('after');
      expect(containerInfo!.firstContainerText).toBe('before text');
      expect(containerInfo!.secondContainerText).toBe('after text');
    });

    it('should preserve text content in before/after containers', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~original sentence~>revised sentence~~}', MARKDOWN_TRANSFORMERS, root);
      });

      const textContent = await editorRead(editor, () => {
        const root = $getRoot();
        let updateNode: DiffTagNodeInline | null = null;

        function traverse(node: any): void {
          if ($isDiffTagNodeInline(node) && (node as DiffTagNodeInline).exportJSON().tag === 'update') {
            updateNode = node;
          }
          if ($isElementNode(node)) {
            node.getChildren().forEach(traverse);
          }
        }
        root.getChildren().forEach(traverse);

        return (updateNode as DiffTagNodeInline | null)?.getTextContent();
      });

      expect(textContent).toContain('original sentence');
      expect(textContent).toContain('revised sentence');
    });
  });

  describe('Error handling for malformed input', () => {
    it('should not create DiffTagNodeInline for malformed substitution (no separator)', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~no separator here~~}', MARKDOWN_TRANSFORMERS, root);
      });

      const diffCount = await countNodesOfType(editor, 'diff-tag');
      // Malformed substitution should not create a diff-tag node
      // OR it should preserve the text without crashing
      const text = await getEditorText(editor);
      expect(text.length).toBeGreaterThan(0);
      // If diff-tag was created, it should not be of type 'update'
      if (diffCount > 0) {
        const nodeInfo = await editorRead(editor, () => {
          const root = $getRoot();
          let foundNode: DiffTagNodeInline | null = null;

          function traverse(node: any): void {
            if ($isDiffTagNodeInline(node)) {
              foundNode = node;
            }
            if ($isElementNode(node)) {
              node.getChildren().forEach(traverse);
            }
          }
          root.getChildren().forEach(traverse);

          return (foundNode as DiffTagNodeInline | null)?.exportJSON().tag;
        });
        // Should not be 'update' since ~> separator is missing
        expect(nodeInfo).not.toBe('update');
      }
    });

    it('should handle multiple ~> separators gracefully', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        // Multiple separators - behavior should be defined
        $convertFromMarkdownString('{~~first~>second~>third~~}', MARKDOWN_TRANSFORMERS, root);
      });

      // Should not throw, text should be preserved
      const text = await getEditorText(editor);
      expect(text.length).toBeGreaterThan(0);
    });

    it('should handle empty before text in substitution', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~  ~>after text~~}', MARKDOWN_TRANSFORMERS, root);
      });

      // Should not throw
      const text = await getEditorText(editor);
      expect(text).toContain('after text');
    });

    it('should handle empty after text in substitution', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{~~before text~>  ~~}', MARKDOWN_TRANSFORMERS, root);
      });

      // Should not throw
      const text = await getEditorText(editor);
      expect(text).toContain('before text');
    });
  });

  describe('Text node ordering after transformation', () => {
    it('should preserve surrounding text when creating inline diff', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('before {++inserted++} after', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toBe('before inserted after');

      // Verify order is correct
      const textParts = await editorRead(editor, () => {
        const root = $getRoot();
        const paragraph = root.getFirstChild();
        if (!$isElementNode(paragraph)) return [];

        return paragraph.getChildren().map((child: any) => ({
          type: child.getType(),
          text: child.getTextContent(),
        }));
      });

      // Should have: text "before ", diff-tag "inserted", text " after"
      expect(textParts.length).toBeGreaterThanOrEqual(3);
      expect(textParts.some((p: any) => p.text.includes('before'))).toBe(true);
      expect(textParts.some((p: any) => p.type === 'diff-tag' && p.text === 'inserted')).toBe(true);
      expect(textParts.some((p: any) => p.text.includes('after'))).toBe(true);
    });

    it('should handle multiple diffs in same paragraph with correct ordering', async () => {
      await editorUpdate(editor, () => {
        const root = $getRoot();
        $convertFromMarkdownString('{++first++} middle {--second--} end', MARKDOWN_TRANSFORMERS, root);
      });

      const text = await getEditorText(editor);
      expect(text).toBe('first middle second end');

      const diffCount = await countNodesOfType(editor, 'diff-tag');
      expect(diffCount).toBe(2);
    });
  });
});
