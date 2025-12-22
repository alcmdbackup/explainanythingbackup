/**
 * Integration tests for DiffTag Accept/Reject functionality (Phase 4)
 * Tests acceptDiffTag() and rejectDiffTag() from diffTagMutations.ts
 *
 * These tests verify the actual editor state mutations when accepting/rejecting diffs.
 */

import { createEditor, LexicalEditor, $getRoot, $createParagraphNode, $createTextNode, $isTextNode } from 'lexical';
import { HeadingNode, $createHeadingNode } from '@lexical/rich-text';
import {
  DiffTagNodeInline,
  DiffTagNodeBlock,
  DiffUpdateContainerInline,
  $createDiffTagNodeInline,
  $createDiffTagNodeBlock,
  $createDiffUpdateContainerInline,
  $isDiffTagNodeInline,
  $isDiffTagNodeBlock,
} from './DiffTagNode';
import { acceptDiffTag, rejectDiffTag } from './diffTagMutations';

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

// Suppress console logs during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

// ============= Insertion Accept/Reject Tests =============

describe('DiffTag Accept/Reject - Insertion (inline)', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('accept: unwraps children and removes diff tag', async () => {
    let nodeKey: string = '';

    // Setup: create paragraph with DiffTagNodeInline containing "inserted text"
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const ins = $createDiffTagNodeInline('ins');
      ins.append($createTextNode('inserted text'));
      nodeKey = ins.getKey();
      paragraph.append(ins);
      root.append(paragraph);
    });

    // Execute: accept the insertion
    await acceptDiffTag(editor, nodeKey);

    // Verify: text remains, diff tag gone
    const result = await editorRead(editor, () => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      if (!paragraph) return { childCount: 0, textContent: '', hasDiffTag: false };

      const children = (paragraph as any).getChildren();
      const hasDiffTag = children.some((c: any) => $isDiffTagNodeInline(c));
      return {
        childCount: children.length,
        textContent: root.getTextContent(),
        hasDiffTag,
      };
    });

    expect(result.textContent).toBe('inserted text');
    expect(result.hasDiffTag).toBe(false);
  });

  it('reject: removes entire node', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const ins = $createDiffTagNodeInline('ins');
      ins.append($createTextNode('inserted text'));
      nodeKey = ins.getKey();
      paragraph.append(ins);
      root.append(paragraph);
    });

    // Execute: reject the insertion
    await rejectDiffTag(editor, nodeKey);

    // Verify: entire node removed
    const result = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getTextContent();
    });

    expect(result).toBe('');
  });
});

// ============= Deletion Accept/Reject Tests =============

describe('DiffTag Accept/Reject - Deletion (inline)', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('accept: removes entire node', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const del = $createDiffTagNodeInline('del');
      del.append($createTextNode('deleted text'));
      nodeKey = del.getKey();
      paragraph.append(del);
      root.append(paragraph);
    });

    // Execute: accept the deletion
    await acceptDiffTag(editor, nodeKey);

    // Verify: entire node removed (deletion accepted)
    const result = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getTextContent();
    });

    expect(result).toBe('');
  });

  it('reject: unwraps children and removes diff tag', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const del = $createDiffTagNodeInline('del');
      del.append($createTextNode('deleted text'));
      nodeKey = del.getKey();
      paragraph.append(del);
      root.append(paragraph);
    });

    // Execute: reject the deletion
    await rejectDiffTag(editor, nodeKey);

    // Verify: text remains (deletion rejected)
    const result = await editorRead(editor, () => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      if (!paragraph) return { textContent: '', hasDiffTag: false };

      const children = (paragraph as any).getChildren();
      const hasDiffTag = children.some((c: any) => $isDiffTagNodeInline(c));
      return {
        textContent: root.getTextContent(),
        hasDiffTag,
      };
    });

    expect(result.textContent).toBe('deleted text');
    expect(result.hasDiffTag).toBe(false);
  });
});

// ============= Update Accept/Reject Tests =============

describe('DiffTag Accept/Reject - Update (inline)', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('accept: keeps second child (after), removes first and diff tag', async () => {
    let nodeKey: string = '';

    // Use DiffUpdateContainerInline to match real structure from importExportUtils
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const update = $createDiffTagNodeInline('update');

      const beforeContainer = $createDiffUpdateContainerInline('before');
      beforeContainer.append($createTextNode('old text'));

      const afterContainer = $createDiffUpdateContainerInline('after');
      afterContainer.append($createTextNode('new text'));

      update.append(beforeContainer);
      update.append(afterContainer);
      nodeKey = update.getKey();
      paragraph.append(update);
      root.append(paragraph);
    });

    // Execute: accept the update
    await acceptDiffTag(editor, nodeKey);

    // Verify: "new text" remains
    const result = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getTextContent();
    });

    expect(result).toBe('new text');
  });

  it('reject: keeps first child (before), removes second and diff tag', async () => {
    let nodeKey: string = '';

    // Use DiffUpdateContainerInline to match real structure from importExportUtils
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const update = $createDiffTagNodeInline('update');

      const beforeContainer = $createDiffUpdateContainerInline('before');
      beforeContainer.append($createTextNode('old text'));

      const afterContainer = $createDiffUpdateContainerInline('after');
      afterContainer.append($createTextNode('new text'));

      update.append(beforeContainer);
      update.append(afterContainer);
      nodeKey = update.getKey();
      paragraph.append(update);
      root.append(paragraph);
    });

    // Execute: reject the update
    await rejectDiffTag(editor, nodeKey);

    // Verify: "old text" remains
    const result = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getTextContent();
    });

    expect(result).toBe('old text');
  });
});

// ============= Update with Container Tests =============

describe('DiffTag Accept/Reject - Update with DiffUpdateContainerInline', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('accept: unwraps DiffUpdateContainerInline children from after container', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const update = $createDiffTagNodeInline('update');

      const beforeContainer = $createDiffUpdateContainerInline('before');
      beforeContainer.append($createTextNode('old'));

      const afterContainer = $createDiffUpdateContainerInline('after');
      afterContainer.append($createTextNode('new'));

      update.append(beforeContainer);
      update.append(afterContainer);
      nodeKey = update.getKey();
      paragraph.append(update);
      root.append(paragraph);
    });

    // Execute: accept
    await acceptDiffTag(editor, nodeKey);

    // Verify: "new" remains, container unwrapped
    const result = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getTextContent();
    });

    expect(result).toBe('new');
  });

  it('reject: unwraps DiffUpdateContainerInline children from before container', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const update = $createDiffTagNodeInline('update');

      const beforeContainer = $createDiffUpdateContainerInline('before');
      beforeContainer.append($createTextNode('old'));

      const afterContainer = $createDiffUpdateContainerInline('after');
      afterContainer.append($createTextNode('new'));

      update.append(beforeContainer);
      update.append(afterContainer);
      nodeKey = update.getKey();
      paragraph.append(update);
      root.append(paragraph);
    });

    // Execute: reject
    await rejectDiffTag(editor, nodeKey);

    // Verify: "old" remains, container unwrapped
    const result = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getTextContent();
    });

    expect(result).toBe('old');
  });
});

// ============= Multi-Child Tests =============

describe('DiffTag Accept/Reject - Multi-child', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('accept ins: unwraps multiple children', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const ins = $createDiffTagNodeInline('ins');
      ins.append($createTextNode('first '));
      ins.append($createTextNode('second '));
      ins.append($createTextNode('third'));
      nodeKey = ins.getKey();
      paragraph.append(ins);
      root.append(paragraph);
    });

    await acceptDiffTag(editor, nodeKey);

    const result = await editorRead(editor, () => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      if (!paragraph) return { childCount: 0, text: '' };

      const children = (paragraph as any).getChildren();
      return {
        childCount: children.length,
        text: root.getTextContent(),
      };
    });

    expect(result.text).toBe('first second third');
    // Note: Lexical may merge adjacent text nodes, so we only verify text content
  });
});

// ============= Sequential Operations Tests =============

describe('DiffTag Accept/Reject - Sequential Operations', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('accept then accept: two operations work correctly', async () => {
    let nodeKey1: string = '';
    let nodeKey2: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();

      const ins1 = $createDiffTagNodeInline('ins');
      ins1.append($createTextNode('first '));
      nodeKey1 = ins1.getKey();

      const ins2 = $createDiffTagNodeInline('ins');
      ins2.append($createTextNode('second'));
      nodeKey2 = ins2.getKey();

      paragraph.append(ins1);
      paragraph.append(ins2);
      root.append(paragraph);
    });

    // Accept first
    await acceptDiffTag(editor, nodeKey1);

    // Accept second
    await acceptDiffTag(editor, nodeKey2);

    const result = await editorRead(editor, () => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      if (!paragraph) return { hasDiffTag: false, text: '' };

      const children = (paragraph as any).getChildren();
      const hasDiffTag = children.some((c: any) => $isDiffTagNodeInline(c));
      return {
        hasDiffTag,
        text: root.getTextContent(),
      };
    });

    expect(result.text).toBe('first second');
    expect(result.hasDiffTag).toBe(false);
  });
});

// ============= Block-Level Tests =============

describe('DiffTag Accept/Reject - Block (DiffTagNodeBlock)', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('accept: DiffTagNodeBlock with heading unwrapped correctly', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const block = $createDiffTagNodeBlock('ins');
      const heading = $createHeadingNode('h1');
      heading.append($createTextNode('Heading Text'));
      block.append(heading);
      nodeKey = block.getKey();
      root.append(block);
    });

    await acceptDiffTag(editor, nodeKey);

    const result = await editorRead(editor, () => {
      const root = $getRoot();
      const children = root.getChildren();
      const hasBlockDiff = children.some((c: any) => $isDiffTagNodeBlock(c));
      return {
        hasBlockDiff,
        text: root.getTextContent(),
        childCount: children.length,
      };
    });

    expect(result.text).toBe('Heading Text');
    expect(result.hasBlockDiff).toBe(false);
  });

  it('reject: DiffTagNodeBlock removed correctly', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const block = $createDiffTagNodeBlock('ins');
      const heading = $createHeadingNode('h1');
      heading.append($createTextNode('Heading Text'));
      block.append(heading);
      nodeKey = block.getKey();
      root.append(block);
    });

    await rejectDiffTag(editor, nodeKey);

    const result = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getTextContent();
    });

    expect(result).toBe('');
  });
});

// ============= Edge Case Tests =============

describe('DiffTag Accept/Reject - Edge Cases', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('handles empty diff node gracefully', async () => {
    let nodeKey: string = '';

    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const ins = $createDiffTagNodeInline('ins');
      // No children appended - empty diff node
      nodeKey = ins.getKey();
      paragraph.append(ins);
      root.append(paragraph);
    });

    // Should not throw
    await expect(acceptDiffTag(editor, nodeKey)).resolves.not.toThrow();

    const result = await editorRead(editor, () => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      if (!paragraph) return { hasDiffTag: true };

      const children = (paragraph as any).getChildren();
      return {
        hasDiffTag: children.some((c: any) => $isDiffTagNodeInline(c)),
      };
    });

    expect(result.hasDiffTag).toBe(false);
  });

  it('handles missing node key gracefully (no crash)', async () => {
    // Use a key that doesn't exist
    const nonExistentKey = 'non-existent-key-12345';

    // Should not throw
    await expect(acceptDiffTag(editor, nonExistentKey)).resolves.not.toThrow();
    await expect(rejectDiffTag(editor, nonExistentKey)).resolves.not.toThrow();
  });
});
