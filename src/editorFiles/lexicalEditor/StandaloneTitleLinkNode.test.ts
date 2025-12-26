/**
 * Tests for StandaloneTitleLinkNode.ts (Phase 7B)
 * Tests custom link node for standalone title functionality
 */

import { createEditor, LexicalEditor, $getRoot, $createParagraphNode, $isParagraphNode } from 'lexical';
import { LinkNode } from '@lexical/link';
import {
  StandaloneTitleLinkNode,
  $createStandaloneTitleLinkNode,
  $isStandaloneTitleLinkNode,
  type SerializedStandaloneTitleLinkNode,
} from './StandaloneTitleLinkNode';

// ============= Test Helpers =============

/**
 * Creates a Lexical editor instance for testing
 */
function createTestEditor(): LexicalEditor {
  return createEditor({
    nodes: [LinkNode, StandaloneTitleLinkNode],
    onError: (error) => {
      throw error;
    },
  });
}

/**
 * Helper to execute code in editor update
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

// Mock window.location
const mockWindowLocation = {
  origin: 'https://example.com',
  href: 'https://example.com',
};

// Mock window.open
const mockWindowOpen = jest.fn();

// Store original values
const originalLocation = window.location;
const originalOpen = window.open;

beforeAll(() => {
  // Delete and redefine location
  delete (window as any).location;
  window.location = mockWindowLocation as any;

  // Mock window.open
  window.open = mockWindowOpen as any;
});

afterAll(() => {
  // Restore original values
  (window as any).location = originalLocation;
  window.open = originalOpen;
});

beforeEach(() => {
  mockWindowLocation.href = 'https://example.com';
  mockWindowOpen.mockClear();
});

// ============= Test Suites =============

describe('StandaloneTitleLinkNode - Node Creation & Type Guards', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should create a standalone title link node', async () => {
    await editorUpdate(editor, () => {
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=test');
      expect(link).toBeInstanceOf(StandaloneTitleLinkNode);
    });
  });

  it('should create a node with attributes', async () => {
    await editorUpdate(editor, () => {
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=test', {
        rel: 'nofollow',
        target: '_blank',
        title: 'Test Title',
      });
      expect(link).toBeInstanceOf(StandaloneTitleLinkNode);
      expect(link.getRel()).toBe('nofollow');
      expect(link.getTarget()).toBe('_blank');
      expect(link.getTitle()).toBe('Test Title');
    });
  });

  it('should have correct type', async () => {
    await editorUpdate(editor, () => {
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=test');
      expect(link.getType()).toBe('standalone-title-link');
    });
  });

  it('should identify standalone title link nodes with type guard', async () => {
    await editorUpdate(editor, () => {
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=test');
      expect($isStandaloneTitleLinkNode(link)).toBe(true);
    });
  });

  it('should not identify regular LinkNode as standalone title link', async () => {
    await editorUpdate(editor, () => {
      const regularLink = new LinkNode('https://example.com');
      expect($isStandaloneTitleLinkNode(regularLink)).toBe(false);
    });
  });

  it('should return false for null node', () => {
    expect($isStandaloneTitleLinkNode(null)).toBe(false);
  });

  it('should return false for undefined node', () => {
    expect($isStandaloneTitleLinkNode(undefined)).toBe(false);
  });
});

describe('StandaloneTitleLinkNode - Cloning & Serialization', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should clone a standalone title link node', async () => {
    await editorUpdate(editor, () => {
      const original = $createStandaloneTitleLinkNode('/standalone-title?t=original', {
        rel: 'nofollow',
        target: '_blank',
        title: 'Original Title',
      });

      const cloned = StandaloneTitleLinkNode.clone(original);

      expect(cloned).toBeInstanceOf(StandaloneTitleLinkNode);
      expect(cloned.getURL()).toBe('/standalone-title?t=original');
      expect(cloned.getRel()).toBe('nofollow');
      expect(cloned.getTarget()).toBe('_blank');
      expect(cloned.getTitle()).toBe('Original Title');
    });
  });

  it('should export to JSON correctly', async () => {
    await editorUpdate(editor, () => {
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=test', {
        rel: 'nofollow',
        target: '_blank',
        title: 'Test',
      });

      const json = link.exportJSON();

      expect(json.type).toBe('standalone-title-link');
      expect(json.url).toBe('/standalone-title?t=test');
      expect(json.rel).toBe('nofollow');
      expect(json.target).toBe('_blank');
      expect(json.title).toBe('Test');
    });
  });

  it('should import from JSON correctly', async () => {
    await editorUpdate(editor, () => {
      const serialized: SerializedStandaloneTitleLinkNode = {
        type: 'standalone-title-link',
        url: '/standalone-title?t=imported',
        rel: 'noopener',
        target: '_blank',
        title: 'Imported',
        version: 1,
        children: [],
        direction: null,
        format: '',
        indent: 0,
      };

      const imported = StandaloneTitleLinkNode.importJSON(serialized);

      expect(imported).toBeInstanceOf(StandaloneTitleLinkNode);
      expect(imported.getURL()).toBe('/standalone-title?t=imported');
      expect(imported.getRel()).toBe('noopener');
      expect(imported.getTarget()).toBe('_blank');
      expect(imported.getTitle()).toBe('Imported');
    });
  });
});

describe('StandaloneTitleLinkNode - DOM Creation', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  // TODO: DOM creation tests require integration test setup with full editor rendering
  it.skip('should create DOM element with correct tag', async () => {
    await editorUpdate(editor, () => {
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=test');
      // createDOM requires EditorConfig which is not easily mockable in unit tests
      // This should be tested in integration tests
    });
  });

  it.skip('should apply custom styling classes', async () => {
    // Requires integration test with DOM rendering
  });

  it.skip('should have href attribute set', async () => {
    // Requires integration test with DOM rendering
  });
});

describe('StandaloneTitleLinkNode - Click Handling', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
    mockWindowLocation.href = 'https://example.com';
    mockWindowOpen.mockClear();
  });

  // TODO: Click handling tests require integration test setup with DOM rendering
  it.skip('should navigate to results page on standalone title click', async () => {
    // Requires integration test with full editor rendering
  });

  it.skip('should handle standalone title with spaces', async () => {
    // Requires integration test
  });

  it.skip('should handle standalone title with special characters', async () => {
    // Requires integration test
  });

  it.skip('should warn on empty standalone title parameter', async () => {
    // Requires integration test
  });

  it.skip('should open regular links with window.open', async () => {
    // Requires integration test
  });

  it.skip('should respect target attribute for non-standalone links', async () => {
    // Requires integration test
  });
});

describe('StandaloneTitleLinkNode - Editor Integration', () => {
  let editor: LexicalEditor;

  beforeEach(() => {
    editor = createTestEditor();
  });

  it('should be appendable to paragraph', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=test');

      paragraph.append(link);
      root.append(paragraph);

      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($isStandaloneTitleLinkNode(children[0])).toBe(true);
    });
  });

  it('should maintain URL after being added to editor', async () => {
    await editorUpdate(editor, () => {
      const root = $getRoot();
      const paragraph = $createParagraphNode();
      const link = $createStandaloneTitleLinkNode('/standalone-title?t=persistent');

      paragraph.append(link);
      root.append(paragraph);
    });

    const url = await editorRead(editor, () => {
      const root = $getRoot();
      const paragraph = root.getFirstChild();
      if ($isParagraphNode(paragraph)) {
        const link = paragraph.getFirstChild();
        if ($isStandaloneTitleLinkNode(link)) {
          return link.getURL();
        }
      }
      return null;
    });

    expect(url).toBe('/standalone-title?t=persistent');
  });
});
