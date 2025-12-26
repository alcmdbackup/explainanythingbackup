/**
 * Integration tests for Prompt-Specific AI Suggestion Cases
 * Tests accept/reject behavior for common prompt patterns:
 * - Remove first sentence
 * - Shorten first paragraph
 * - Improve entire article
 */

import { createEditor, LexicalEditor, $getRoot } from 'lexical';
import { HeadingNode } from '@lexical/rich-text';
import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  DiffTagNodeInline,
  DiffTagNodeBlock,
  DiffUpdateContainerInline,
  $isDiffTagNodeInline,
  $isDiffTagNodeBlock,
} from './DiffTagNode';
import { acceptDiffTag, rejectDiffTag } from './diffTagMutations';
import { MARKDOWN_TRANSFORMERS, preprocessCriticMarkup } from './importExportUtils';
import { AI_PIPELINE_FIXTURES } from '@/testing/utils/editor-test-helpers';

// ============= Test Helpers =============

function createTestEditor(): LexicalEditor {
  return createEditor({
    nodes: [HeadingNode, DiffTagNodeInline, DiffTagNodeBlock, DiffUpdateContainerInline],
    onError: (error) => {
      throw error;
    },
  });
}

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
 * Setup editor with CriticMarkup content from fixture
 */
async function setupEditorWithFixture(editor: LexicalEditor, criticMarkupContent: string): Promise<void> {
  const preprocessed = preprocessCriticMarkup(criticMarkupContent);
  await editorUpdate(editor, () => {
    const root = $getRoot();
    root.clear();
    $convertFromMarkdownString(preprocessed, MARKDOWN_TRANSFORMERS, root);
  });
}

/**
 * Get all DiffTagNode keys from editor
 */
async function getAllDiffNodeKeys(editor: LexicalEditor): Promise<string[]> {
  return await editorRead(editor, () => {
    const root = $getRoot();
    const keys: string[] = [];

    function traverse(node: any) {
      if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
        keys.push(node.getKey());
      }
      if (node.getChildren) {
        node.getChildren().forEach(traverse);
      }
    }

    root.getChildren().forEach(traverse);
    return keys;
  });
}

/**
 * Get count of diff nodes in editor
 */
async function getDiffNodeCount(editor: LexicalEditor): Promise<number> {
  const keys = await getAllDiffNodeKeys(editor);
  return keys.length;
}

/**
 * Accept all diff tags in order
 */
async function acceptAllDiffs(editor: LexicalEditor): Promise<void> {
  let keys = await getAllDiffNodeKeys(editor);
  while (keys.length > 0) {
    await acceptDiffTag(editor, keys[0]);
    keys = await getAllDiffNodeKeys(editor);
  }
}

/**
 * Reject all diff tags in order
 */
async function rejectAllDiffs(editor: LexicalEditor): Promise<void> {
  let keys = await getAllDiffNodeKeys(editor);
  while (keys.length > 0) {
    await rejectDiffTag(editor, keys[0]);
    keys = await getAllDiffNodeKeys(editor);
  }
}

/**
 * Get plain text content from editor
 */
async function getEditorTextContent(editor: LexicalEditor): Promise<string> {
  return await editorRead(editor, () => {
    const root = $getRoot();
    return root.getTextContent();
  });
}

// Suppress console logs during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

// ============= Remove First Sentence Tests =============

describe('Prompt-Specific: Remove First Sentence', () => {
  const fixture = AI_PIPELINE_FIXTURES.promptSpecific.removeFirstSentence;
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create deletion diff for removed sentence', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    const diffCount = await getDiffNodeCount(editor);
    expect(diffCount).toBe(fixture.expectedDiffNodeCount);
  });

  it('accept removes the sentence from content', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    await acceptAllDiffs(editor);

    const content = await getEditorTextContent(editor);
    expect(content).not.toContain('This introductory sentence is outdated');
    expect(content).toContain('Quantum physics describes nature');
  });

  it('reject keeps the sentence in content', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    await rejectAllDiffs(editor);

    const content = await getEditorTextContent(editor);
    expect(content).toContain('This introductory sentence is outdated');
    expect(content).toContain('Quantum physics describes nature');
  });
});

// ============= Shorten First Paragraph Tests =============

describe('Prompt-Specific: Shorten First Paragraph', () => {
  const fixture = AI_PIPELINE_FIXTURES.promptSpecific.shortenFirstParagraph;
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create deletion and insertion diffs', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    const diffCount = await getDiffNodeCount(editor);
    expect(diffCount).toBe(fixture.expectedDiffNodeCount);
  });

  it('accept all replaces verbose paragraph with concise version', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    await acceptAllDiffs(editor);

    const content = await getEditorTextContent(editor);
    expect(content).not.toContain('subset of artificial intelligence');
    expect(content).toContain('Machine learning builds systems that learn from data');
  });

  it('reject all keeps original verbose paragraph', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    await rejectAllDiffs(editor);

    const content = await getEditorTextContent(editor);
    expect(content).toContain('subset of artificial intelligence');
    expect(content).not.toContain('Machine learning builds systems that learn from data');
  });
});

// ============= Improve Entire Article Tests =============

describe('Prompt-Specific: Improve Entire Article', () => {
  const fixture = AI_PIPELINE_FIXTURES.promptSpecific.improveEntireArticle;
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create multiple diffs across headings and paragraphs', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    const diffCount = await getDiffNodeCount(editor);
    expect(diffCount).toBe(fixture.expectedDiffNodeCount);
  });

  it('accept all transforms article to improved version', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    await acceptAllDiffs(editor);

    const content = await getEditorTextContent(editor);
    // Improved heading
    expect(content).toContain('Understanding Climate Change');
    // Improved content
    expect(content).toContain('long-term shifts in global temperatures');
    expect(content).not.toContain('Climate change is bad');
  });

  it('reject all keeps original poor quality article', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    await rejectAllDiffs(editor);

    const content = await getEditorTextContent(editor);
    expect(content).toContain('Climate change is bad');
    expect(content).not.toContain('long-term shifts');
  });

  it('partial accept keeps some improvements, rejects others', async () => {
    await setupEditorWithFixture(editor, fixture.expectedStep4Output);

    const diffKeys = await getAllDiffNodeKeys(editor);
    expect(diffKeys.length).toBeGreaterThanOrEqual(4);

    // Accept first two diffs (heading changes)
    await acceptDiffTag(editor, diffKeys[0]);
    await acceptDiffTag(editor, diffKeys[1]);

    // Get remaining keys and reject rest
    const remainingKeys = await getAllDiffNodeKeys(editor);
    for (const key of remainingKeys) {
      await rejectDiffTag(editor, key);
    }

    const content = await getEditorTextContent(editor);
    // Should have improved heading (accepted) but original body text (rejected)
    expect(content).toContain('Understanding Climate Change');
    expect(content).toContain('Climate change is bad');
  });
});
