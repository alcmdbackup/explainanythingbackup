/**
 * Tests for DiffTagNode.ts (Phase 7C)
 * Tests three custom node classes: DiffTagNodeInline, DiffTagNodeBlock, DiffUpdateContainerInline
 */

import { createEditor, LexicalEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
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
  $isDiffUpdateContainerInline,
} from './DiffTagNode';

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

// ============= DiffTagNodeInline Tests =============

describe('DiffTagNodeInline - Node Creation & Type Guards', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create insertion node', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      expect(node).toBeInstanceOf(DiffTagNodeInline);
      expect(node.getType()).toBe('diff-tag');
    });
  });

  it('should create deletion node', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('del');
      expect(node).toBeInstanceOf(DiffTagNodeInline);
    });
  });

  it('should create update node', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('update');
      expect(node).toBeInstanceOf(DiffTagNodeInline);
    });
  });

  it('should identify DiffTagNodeInline with type guard', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      expect($isDiffTagNodeInline(node)).toBe(true);
    });
  });

  it('should return false for null node', () => {
    expect($isDiffTagNodeInline(null)).toBe(false);
  });

  it('should return false for undefined node', () => {
    expect($isDiffTagNodeInline(undefined)).toBe(false);
  });

  it('should return true for isInline()', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      expect(node.isInline()).toBe(true);
    });
  });
});

describe('DiffTagNodeInline - Cloning', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should clone insertion node', async () => {
    await editorUpdate(editor, () => {
      const original = $createDiffTagNodeInline('ins');
      const cloned = DiffTagNodeInline.clone(original);

      expect(cloned).toBeInstanceOf(DiffTagNodeInline);
      expect(cloned.getType()).toBe('diff-tag');
    });
  });

  it('should clone deletion node', async () => {
    await editorUpdate(editor, () => {
      const original = $createDiffTagNodeInline('del');
      const cloned = DiffTagNodeInline.clone(original);

      expect(cloned).toBeInstanceOf(DiffTagNodeInline);
    });
  });

  it('should clone update node', async () => {
    await editorUpdate(editor, () => {
      const original = $createDiffTagNodeInline('update');
      const cloned = DiffTagNodeInline.clone(original);

      expect(cloned).toBeInstanceOf(DiffTagNodeInline);
    });
  });
});

describe('DiffTagNodeInline - JSON Serialization', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should export insertion node to JSON', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      const json = node.exportJSON();

      expect(json.type).toBe('diff-tag');
      expect(json.version).toBe(1);
      expect(json.tag).toBe('ins');
    });
  });

  it('should export deletion node to JSON', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('del');
      const json = node.exportJSON();

      expect(json.type).toBe('diff-tag');
      expect(json.tag).toBe('del');
    });
  });

  it('should export update node to JSON', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('update');
      const json = node.exportJSON();

      expect(json.tag).toBe('update');
    });
  });

  it('should import insertion node from JSON', async () => {
    await editorUpdate(editor, () => {
      const json = { type: 'diff-tag', version: 1, tag: 'ins', key: 'test-key' };
      const imported = DiffTagNodeInline.importJSON(json);

      expect(imported).toBeInstanceOf(DiffTagNodeInline);
      expect($isDiffTagNodeInline(imported)).toBe(true);
    });
  });

  it('should import deletion node from JSON', async () => {
    await editorUpdate(editor, () => {
      const json = { type: 'diff-tag', version: 1, tag: 'del', key: 'test-key' };
      const imported = DiffTagNodeInline.importJSON(json);

      expect(imported).toBeInstanceOf(DiffTagNodeInline);
    });
  });

  it('should import update node from JSON', async () => {
    await editorUpdate(editor, () => {
      const json = { type: 'diff-tag', version: 1, tag: 'update', key: 'test-key' };
      const imported = DiffTagNodeInline.importJSON(json);

      expect(imported).toBeInstanceOf(DiffTagNodeInline);
    });
  });
});

describe('DiffTagNodeInline - Markdown Export', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should export insertion node as CriticMarkup', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      node.append($createTextNode('inserted text'));

      const markdown = node.exportMarkdown();

      expect(markdown).toBe('{++inserted text++}');
    });
  });

  it('should export deletion node as CriticMarkup', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('del');
      node.append($createTextNode('deleted text'));

      const markdown = node.exportMarkdown();

      expect(markdown).toBe('{--deleted text--}');
    });
  });

  it('should export update node as CriticMarkup with two children', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('update');
      node.append($createTextNode('old text'));
      node.append($createTextNode('new text'));

      const markdown = node.exportMarkdown();

      expect(markdown).toBe('{~~old text~>new text~~}');
    });
  });

  it('should handle update node with insufficient children', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('update');
      node.append($createTextNode('only one child'));

      const markdown = node.exportMarkdown();

      expect(markdown).toBe('{~~~>~~}');
    });
  });

  it('should export insertion with bold formatting', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      const text = $createTextNode('bold text');
      text.toggleFormat('bold');
      node.append(text);

      const markdown = node.exportMarkdown();

      expect(markdown).toContain('**bold text**');
      expect(markdown).toContain('{++');
      expect(markdown).toContain('++}');
    });
  });

  it('should export insertion with italic formatting', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      const text = $createTextNode('italic text');
      text.toggleFormat('italic');
      node.append(text);

      const markdown = node.exportMarkdown();

      expect(markdown).toContain('*italic text*');
    });
  });

  it('should export insertion with strikethrough formatting', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      const text = $createTextNode('struck text');
      text.toggleFormat('strikethrough');
      node.append(text);

      const markdown = node.exportMarkdown();

      expect(markdown).toContain('~~struck text~~');
    });
  });

  it('should export insertion with heading child', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      const heading = $createHeadingNode('h1');
      heading.append($createTextNode('Heading Text'));
      node.append(heading);

      const markdown = node.exportMarkdown();

      expect(markdown).toContain('# Heading Text');
    });
  });

  it('should handle empty insertion node', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');

      const markdown = node.exportMarkdown();

      expect(markdown).toBe('{++++}');
    });
  });

  it('should handle empty deletion node', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('del');

      const markdown = node.exportMarkdown();

      expect(markdown).toBe('{----}');
    });
  });
});

describe('DiffTagNodeInline - DOM Operations', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create ins DOM element for insertion', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      const dom = node.createDOM();

      expect(dom.tagName).toBe('INS');
      expect(dom.className).toBe('diff-tag-insert');
    });
  });

  it('should create del DOM element for deletion', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('del');
      const dom = node.createDOM();

      expect(dom.tagName).toBe('DEL');
      expect(dom.className).toBe('diff-tag-delete');
    });
  });

  it('should create span DOM element for update', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('update');
      const dom = node.createDOM();

      expect(dom.tagName).toBe('SPAN');
      expect(dom.className).toBe('diff-tag-update');
    });
  });

  it('should update DOM when tag changes', async () => {
    await editorUpdate(editor, () => {
      const node1 = $createDiffTagNodeInline('ins');
      const node2 = $createDiffTagNodeInline('del');

      const shouldUpdate = node1.updateDOM(node2);

      expect(shouldUpdate).toBe(true);
    });
  });

  it('should not update DOM when tag stays same', async () => {
    await editorUpdate(editor, () => {
      const node1 = $createDiffTagNodeInline('ins');
      const node2 = $createDiffTagNodeInline('ins');

      const shouldUpdate = node1.updateDOM(node2);

      expect(shouldUpdate).toBe(false);
    });
  });

  it('should export ins DOM element', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      const exported = node.exportDOM();

      expect((exported.element as HTMLElement)?.tagName).toBe('INS');
      expect((exported.element as HTMLElement)?.className).toBe('diff-tag-insert');
    });
  });

  it('should export del DOM element', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('del');
      const exported = node.exportDOM();

      expect((exported.element as HTMLElement)?.tagName).toBe('DEL');
    });
  });

  it('should export span DOM element for update', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('update');
      const exported = node.exportDOM();

      expect((exported.element as HTMLElement)?.tagName).toBe('SPAN');
      expect((exported.element as HTMLElement)?.className).toBe('diff-tag-update');
    });
  });
});

// ============= DiffTagNodeBlock Tests =============

describe('DiffTagNodeBlock - Node Creation & Behavior', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create block-level diff node', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeBlock('ins');
      expect(node).toBeInstanceOf(DiffTagNodeBlock);
      expect(node.getType()).toBe('diff-tag-block');
    });
  });

  it('should return false for isInline()', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeBlock('ins');
      expect(node.isInline()).toBe(false);
    });
  });

  it('should identify DiffTagNodeBlock with type guard', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeBlock('ins');
      expect($isDiffTagNodeBlock(node)).toBe(true);
    });
  });

  it('should not identify DiffTagNodeInline as DiffTagNodeBlock', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffTagNodeInline('ins');
      expect($isDiffTagNodeBlock(node)).toBe(false);
    });
  });

  it('should clone block node', async () => {
    await editorUpdate(editor, () => {
      const original = $createDiffTagNodeBlock('del');
      const cloned = DiffTagNodeBlock.clone(original);

      expect(cloned).toBeInstanceOf(DiffTagNodeBlock);
      expect(cloned.getType()).toBe('diff-tag-block');
    });
  });

  it('should import block node from JSON', async () => {
    await editorUpdate(editor, () => {
      const json = { type: 'diff-tag-block', version: 1, tag: 'ins', key: 'test-key' };
      const imported = DiffTagNodeBlock.importJSON(json);

      expect(imported).toBeInstanceOf(DiffTagNodeBlock);
      expect(imported.isInline()).toBe(false);
    });
  });
});

// ============= DiffUpdateContainerInline Tests =============

describe('DiffUpdateContainerInline - Node Creation', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create before container', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      expect(node).toBeInstanceOf(DiffUpdateContainerInline);
      expect(node.getType()).toBe('diff-update-container-inline');
    });
  });

  it('should create after container', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('after');
      expect(node).toBeInstanceOf(DiffUpdateContainerInline);
    });
  });

  it('should identify with type guard', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      expect($isDiffUpdateContainerInline(node)).toBe(true);
    });
  });

  it('should return false for null', () => {
    expect($isDiffUpdateContainerInline(null)).toBe(false);
  });

  it('should return true for isInline()', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      expect(node.isInline()).toBe(true);
    });
  });

  it('should not allow empty container', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      expect(node.canBeEmpty()).toBe(false);
    });
  });

  it('should not allow text insertion before', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      expect(node.canInsertTextBefore()).toBe(false);
    });
  });

  it('should not allow text insertion after', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      expect(node.canInsertTextAfter()).toBe(false);
    });
  });
});

describe('DiffUpdateContainerInline - Cloning & Serialization', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should clone before container', async () => {
    await editorUpdate(editor, () => {
      const original = $createDiffUpdateContainerInline('before');
      const cloned = DiffUpdateContainerInline.clone(original);

      expect(cloned).toBeInstanceOf(DiffUpdateContainerInline);
    });
  });

  it('should clone after container', async () => {
    await editorUpdate(editor, () => {
      const original = $createDiffUpdateContainerInline('after');
      const cloned = DiffUpdateContainerInline.clone(original);

      expect(cloned).toBeInstanceOf(DiffUpdateContainerInline);
    });
  });

  it('should export before container to JSON', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      const json = node.exportJSON();

      expect(json.type).toBe('diff-update-container-inline');
      expect(json.version).toBe(1);
      expect(json.containerType).toBe('before');
    });
  });

  it('should export after container to JSON', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('after');
      const json = node.exportJSON();

      expect(json.containerType).toBe('after');
    });
  });

  it('should import before container from JSON', async () => {
    await editorUpdate(editor, () => {
      const json = { type: 'diff-update-container-inline', version: 1, containerType: 'before' };
      const imported = DiffUpdateContainerInline.importJSON(json);

      expect(imported).toBeInstanceOf(DiffUpdateContainerInline);
    });
  });

  it('should import after container from JSON', async () => {
    await editorUpdate(editor, () => {
      const json = { type: 'diff-update-container-inline', version: 1, containerType: 'after' };
      const imported = DiffUpdateContainerInline.importJSON(json);

      expect(imported).toBeInstanceOf(DiffUpdateContainerInline);
    });
  });
});

describe('DiffUpdateContainerInline - DOM Operations', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create span DOM with before class', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      const dom = node.createDOM();

      expect(dom.tagName).toBe('SPAN');
      expect(dom.className).toBe('diff-update-container-before');
    });
  });

  it('should create span DOM with after class', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('after');
      const dom = node.createDOM();

      expect(dom.tagName).toBe('SPAN');
      expect(dom.className).toBe('diff-update-container-after');
    });
  });

  it('should update DOM when container type changes', async () => {
    await editorUpdate(editor, () => {
      const node1 = $createDiffUpdateContainerInline('before');
      const node2 = $createDiffUpdateContainerInline('after');

      const shouldUpdate = node1.updateDOM(node2);

      expect(shouldUpdate).toBe(true);
    });
  });

  it('should not update DOM when container type stays same', async () => {
    await editorUpdate(editor, () => {
      const node1 = $createDiffUpdateContainerInline('before');
      const node2 = $createDiffUpdateContainerInline('before');

      const shouldUpdate = node1.updateDOM(node2);

      expect(shouldUpdate).toBe(false);
    });
  });

  it('should export before container DOM', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('before');
      const exported = node.exportDOM();

      expect((exported.element as HTMLElement)?.tagName).toBe('SPAN');
      expect((exported.element as HTMLElement)?.className).toBe('diff-update-container-before');
    });
  });

  it('should export after container DOM', async () => {
    await editorUpdate(editor, () => {
      const node = $createDiffUpdateContainerInline('after');
      const exported = node.exportDOM();

      expect((exported.element as HTMLElement)?.className).toBe('diff-update-container-after');
    });
  });
});

describe('DiffTagNode - Editor Integration', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should append diff node to paragraph', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const diff = $createDiffTagNodeInline('ins');
      diff.append($createTextNode('content'));

      paragraph.append(diff);
      root.append(paragraph);

      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($isDiffTagNodeInline(children[0])).toBe(true);
    });
  });

  it('should handle nested update containers', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const diff = $createDiffTagNodeInline('update');

      const beforeContainer = $createDiffUpdateContainerInline('before');
      beforeContainer.append($createTextNode('old'));

      const afterContainer = $createDiffUpdateContainerInline('after');
      afterContainer.append($createTextNode('new'));

      diff.append(beforeContainer);
      diff.append(afterContainer);
      paragraph.append(diff);
      root.append(paragraph);

      const diffNode = paragraph.getFirstChild();
      expect($isDiffTagNodeInline(diffNode)).toBe(true);
      if ($isDiffTagNodeInline(diffNode)) {
        expect(diffNode.getChildrenSize()).toBe(2);
      }
    });
  });

  it('should maintain text content after adding to editor', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const diff = $createDiffTagNodeInline('ins');
      diff.append($createTextNode('test content'));

      paragraph.append(diff);
      root.append(paragraph);
    });

    const text = await editorRead(editor, () => {
      const root = $getRoot();
      return root.getTextContent();
    });

    expect(text).toBe('test content');
  });
});
