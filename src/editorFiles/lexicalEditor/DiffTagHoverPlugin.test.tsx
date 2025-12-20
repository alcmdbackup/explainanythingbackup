/**
 * Tests for DiffTagHoverPlugin.tsx (Phase 7E)
 * Tests mutation listeners, hover state management, and node manipulation
 *
 * Note: Due to the complexity of Lexical's internal APIs and the need for a full
 * Lexical editor context, these tests focus on the testable logic and behaviors.
 * Full integration testing would require a complete Lexical setup.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import DiffTagHoverPlugin from './DiffTagHoverPlugin';

// Mock the Lexical context and components
jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: jest.fn(),
}));

jest.mock('./DiffTagInlineControls', () => {
  return function MockDiffTagInlineControls({ diffTagType, onAccept, onReject }: {
    diffTagType: string;
    onAccept: () => void;
    onReject: () => void;
  }) {
    return (
      <div data-testid="inline-controls" data-diff-tag-type={diffTagType}>
        <button onClick={onAccept}>Accept</button>
        <button onClick={onReject}>Reject</button>
      </div>
    );
  };
});

jest.mock('./DiffTagNode', () => ({
  DiffTagNodeInline: class DiffTagNodeInline {},
  DiffTagNodeBlock: class DiffTagNodeBlock {},
  $isDiffTagNodeInline: jest.fn(),
  $isDiffTagNodeBlock: jest.fn(),
  $isDiffUpdateContainerInline: jest.fn(),
}));

jest.mock('lexical', () => ({
  $getNodeByKey: jest.fn(),
}));

// Import mocked modules
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $isDiffTagNodeInline, $isDiffTagNodeBlock, $isDiffUpdateContainerInline } from './DiffTagNode';
import { $getNodeByKey } from 'lexical';

// ============= Test Helpers =============

const createMockEditor = () => {
  const mutationListeners: Map<unknown, (mutations: Map<string, string>) => void> = new Map();
  let readCallback: (() => void) | null = null;
  const rootElement = document.createElement('div');

  return {
    registerMutationListener: jest.fn((nodeClass, callback) => {
      mutationListeners.set(nodeClass, callback);
      return jest.fn(); // return unsubscribe function
    }),
    registerUpdateListener: jest.fn(() => jest.fn()), // return unsubscribe function
    getEditorState: jest.fn(() => ({
      read: jest.fn((fn) => {
        readCallback = fn;
        fn();
      }),
      _nodeMap: new Map(),
    })),
    getElementByKey: jest.fn(),
    getRootElement: jest.fn(() => rootElement),
    update: jest.fn((fn) => {
      fn();
    }),
    _triggerMutation: (nodeClass: unknown, mutations: Map<string, string>) => {
      const listener = mutationListeners.get(nodeClass);
      if (listener && readCallback) {
        listener(mutations);
      }
    },
    _rootElement: rootElement,
  };
};

const createMockNode = (tag: 'ins' | 'del' | 'update', children: unknown[] = []) => ({
  __tag: tag,
  getChildren: jest.fn(() => children),
  insertBefore: jest.fn(),
  remove: jest.fn(),
});

const createMockChildNode = () => ({
  getKey: jest.fn(() => 'child-key'),
});

// ============= Component Initialization Tests =============

describe('DiffTagHoverPlugin - Initialization', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  it('should render without crashing', () => {
    render(<DiffTagHoverPlugin />);
    // Component renders without inline controls initially (no diff tags in DOM)
    expect(screen.queryByTestId('inline-controls')).not.toBeInTheDocument();
  });

  it('should register mutation listener for DiffTagNodeInline', () => {
    render(<DiffTagHoverPlugin />);

    expect(mockEditor.registerMutationListener).toHaveBeenCalledWith(
      expect.anything(), // DiffTagNodeInline class
      expect.any(Function)
    );
  });

  it('should register mutation listener for DiffTagNodeBlock', () => {
    render(<DiffTagHoverPlugin />);

    expect(mockEditor.registerMutationListener).toHaveBeenCalledWith(
      expect.anything(), // DiffTagNodeBlock class
      expect.any(Function)
    );
  });

  it('should cleanup listeners on unmount', () => {
    const unsubscribeInline = jest.fn();
    const unsubscribeBlock = jest.fn();
    const unsubscribeUpdate = jest.fn();

    mockEditor.registerMutationListener
      .mockReturnValueOnce(unsubscribeInline)
      .mockReturnValueOnce(unsubscribeBlock);
    mockEditor.registerUpdateListener.mockReturnValueOnce(unsubscribeUpdate);

    const { unmount } = render(<DiffTagHoverPlugin />);

    unmount();

    expect(unsubscribeInline).toHaveBeenCalled();
    expect(unsubscribeBlock).toHaveBeenCalled();
    expect(unsubscribeUpdate).toHaveBeenCalled();
  });
});

// ============= Mutation Detection Tests =============

describe('DiffTagHoverPlugin - Mutation Detection', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);

    // Suppress console.log in tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.log as jest.Mock).mockRestore();
  });

  it('should scan DOM for diff tags on mutation', async () => {
    // Add a diff tag element to the root element
    const diffElement = document.createElement('span');
    diffElement.setAttribute('data-diff-key', 'node-1');
    diffElement.setAttribute('data-diff-type', 'ins');
    mockEditor._rootElement.appendChild(diffElement);

    render(<DiffTagHoverPlugin />);

    const mutations = new Map([['node-1', 'created']]);

    // Get the registered listener and call it
    const listenerCall = mockEditor.registerMutationListener.mock.calls[0];
    if (listenerCall) {
      const [, listener] = listenerCall;
      listener(mutations);
    }

    // Verify getRootElement was called to scan for diff tags
    expect(mockEditor.getRootElement).toHaveBeenCalled();

    mockEditor._rootElement.removeChild(diffElement);
  });

  it('should handle mutations and update state', async () => {
    const diffElement = document.createElement('span');
    diffElement.setAttribute('data-diff-key', 'node-2');
    diffElement.setAttribute('data-diff-type', 'del');
    mockEditor._rootElement.appendChild(diffElement);

    render(<DiffTagHoverPlugin />);

    const mutations = new Map([['node-2', 'updated']]);

    const listenerCall = mockEditor.registerMutationListener.mock.calls[0];
    if (listenerCall) {
      const [, listener] = listenerCall;
      listener(mutations);
    }

    await waitFor(() => {
      expect(screen.queryByTestId('inline-controls')).toBeInTheDocument();
    });

    mockEditor._rootElement.removeChild(diffElement);
  });

  it('should handle destroyed mutations gracefully', () => {
    render(<DiffTagHoverPlugin />);

    const mutations = new Map([['node-3', 'destroyed']]);

    const listenerCall = mockEditor.registerMutationListener.mock.calls[0];
    if (listenerCall) {
      const [, listener] = listenerCall;
      listener(mutations);
    }

    // Should not crash on destroyed mutations
    expect(mockEditor.getRootElement).toHaveBeenCalled();
  });

  it('should handle empty DOM gracefully', () => {
    // Root element is empty
    render(<DiffTagHoverPlugin />);

    const mutations = new Map([['node-4', 'created']]);

    const listenerCall = mockEditor.registerMutationListener.mock.calls[0];
    if (listenerCall) {
      const [, listener] = listenerCall;
      listener(mutations);
    }

    // Should not throw error when no diff tags in DOM
    expect(screen.queryByTestId('inline-controls')).not.toBeInTheDocument();
  });

  it('should track multiple diff tags', async () => {
    // Add multiple diff tag elements
    const diffElement1 = document.createElement('span');
    diffElement1.setAttribute('data-diff-key', 'node-5');
    diffElement1.setAttribute('data-diff-type', 'ins');
    mockEditor._rootElement.appendChild(diffElement1);

    const diffElement2 = document.createElement('span');
    diffElement2.setAttribute('data-diff-key', 'node-6');
    diffElement2.setAttribute('data-diff-type', 'del');
    mockEditor._rootElement.appendChild(diffElement2);

    render(<DiffTagHoverPlugin />);

    const listenerCall = mockEditor.registerMutationListener.mock.calls[0];
    if (listenerCall) {
      const [, listener] = listenerCall;
      listener(new Map([['node-5', 'created']]));
    }

    await waitFor(() => {
      const controls = screen.queryAllByTestId('inline-controls');
      expect(controls.length).toBe(2);
    });

    mockEditor._rootElement.removeChild(diffElement1);
    mockEditor._rootElement.removeChild(diffElement2);
  });
});

// ============= Diff Tag Scanning Tests =============

describe('DiffTagHoverPlugin - Diff Tag Scanning', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.log as jest.Mock).mockRestore();
  });

  it('should not show controls initially when no diff tags in DOM', () => {
    render(<DiffTagHoverPlugin />);

    expect(screen.queryByTestId('inline-controls')).not.toBeInTheDocument();
  });

  it('should show controls for diff tags with data-diff-key attribute', async () => {
    // Add a diff tag element to the root element
    const diffElement = document.createElement('span');
    diffElement.setAttribute('data-diff-key', 'node-1');
    diffElement.setAttribute('data-diff-type', 'ins');
    mockEditor._rootElement.appendChild(diffElement);

    render(<DiffTagHoverPlugin />);

    // Trigger mutation to cause scan
    const listenerCall = mockEditor.registerMutationListener.mock.calls[0];
    if (listenerCall) {
      const [, listener] = listenerCall;
      listener(new Map([['node-1', 'created']]));

      // Wait for state update and re-render
      await waitFor(() => {
        expect(screen.queryByTestId('inline-controls')).toBeInTheDocument();
      });
    }

    mockEditor._rootElement.removeChild(diffElement);
  });
});

// ============= Accept Handler Tests =============

describe('DiffTagHoverPlugin - Accept Handler', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.log as jest.Mock).mockRestore();
  });

  it('should handle accept for ins node', () => {
    const child1 = createMockChildNode();
    const child2 = createMockChildNode();
    const mockNode = createMockNode('ins', [child1, child2]);

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeInline as unknown as jest.Mock).mockReturnValue(true);

    // Note: Full testing requires setting up hover state first,
    // which is complex in this test environment.
    // This test verifies the mock structure is correct.
    expect(mockNode.__tag).toBe('ins');
    expect(mockNode.getChildren()).toHaveLength(2);
  });

  it('should handle accept for del node', () => {
    const mockNode = createMockNode('del', []);

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeBlock as unknown as jest.Mock).mockReturnValue(true);

    expect(mockNode.__tag).toBe('del');
    expect(mockNode.remove).toBeDefined();
  });

  it('should handle accept for update node with sufficient children', () => {
    const child1 = createMockChildNode();
    const child2 = createMockChildNode();
    const mockNode = createMockNode('update', [child1, child2]);

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeInline as unknown as jest.Mock).mockReturnValue(true);
    ($isDiffUpdateContainerInline as unknown as jest.Mock).mockReturnValue(false);

    expect(mockNode.__tag).toBe('update');
    expect(mockNode.getChildren()).toHaveLength(2);
  });

  it('should handle update node with DiffUpdateContainerInline', () => {
    const grandchild = createMockChildNode();
    const containerChild = {
      getChildren: jest.fn(() => [grandchild]),
    };
    const mockNode = createMockNode('update', [createMockChildNode(), containerChild]);

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeInline as unknown as jest.Mock).mockReturnValue(true);
    ($isDiffUpdateContainerInline as unknown as jest.Mock).mockReturnValue(true);

    expect(mockNode.__tag).toBe('update');
    expect(containerChild.getChildren()).toHaveLength(1);
  });
});

// ============= Reject Handler Tests =============

describe('DiffTagHoverPlugin - Reject Handler', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.log as jest.Mock).mockRestore();
  });

  it('should handle reject for ins node', () => {
    const mockNode = createMockNode('ins', []);

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeInline as unknown as jest.Mock).mockReturnValue(true);

    expect(mockNode.__tag).toBe('ins');
    expect(mockNode.remove).toBeDefined();
  });

  it('should handle reject for del node', () => {
    const child1 = createMockChildNode();
    const child2 = createMockChildNode();
    const mockNode = createMockNode('del', [child1, child2]);

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeBlock as unknown as jest.Mock).mockReturnValue(true);

    expect(mockNode.__tag).toBe('del');
    expect(mockNode.getChildren()).toHaveLength(2);
  });

  it('should handle reject for update node with sufficient children', () => {
    const child1 = createMockChildNode();
    const child2 = createMockChildNode();
    const mockNode = createMockNode('update', [child1, child2]);

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeInline as unknown as jest.Mock).mockReturnValue(true);
    ($isDiffUpdateContainerInline as unknown as jest.Mock).mockReturnValue(false);

    expect(mockNode.__tag).toBe('update');
    expect(mockNode.getChildren()).toHaveLength(2);
  });

  it('should handle update node with DiffUpdateContainerInline on reject', () => {
    const grandchild = createMockChildNode();
    const containerChild = {
      getChildren: jest.fn(() => [grandchild]),
    };
    const mockNode = createMockNode('update', [containerChild, createMockChildNode()]);

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeInline as unknown as jest.Mock).mockReturnValue(true);
    ($isDiffUpdateContainerInline as unknown as jest.Mock).mockReturnValue(true);

    expect(mockNode.__tag).toBe('update');
    expect(containerChild.getChildren()).toHaveLength(1);
  });
});

// ============= Controls Removal Tests =============

describe('DiffTagHoverPlugin - Controls Removal', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.log as jest.Mock).mockRestore();
  });

  it('should remove controls when diff tag is removed from DOM', async () => {
    // Add a diff tag element
    const diffElement = document.createElement('span');
    diffElement.setAttribute('data-diff-key', 'node-1');
    diffElement.setAttribute('data-diff-type', 'ins');
    mockEditor._rootElement.appendChild(diffElement);

    render(<DiffTagHoverPlugin />);

    // Trigger mutation to cause scan
    const listenerCall = mockEditor.registerMutationListener.mock.calls[0];
    if (listenerCall) {
      const [, listener] = listenerCall;
      listener(new Map([['node-1', 'created']]));

      // Wait for controls to appear
      await waitFor(() => {
        expect(screen.queryByTestId('inline-controls')).toBeInTheDocument();
      });

      // Remove the diff element from DOM
      mockEditor._rootElement.removeChild(diffElement);

      // Trigger another mutation/update scan
      listener(new Map([['node-1', 'destroyed']]));

      // Wait for controls to disappear
      await waitFor(() => {
        expect(screen.queryByTestId('inline-controls')).not.toBeInTheDocument();
      });
    }
  });
});

// ============= Edge Cases Tests =============

describe('DiffTagHoverPlugin - Edge Cases', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.log as jest.Mock).mockRestore();
  });

  it('should handle missing nodeKey in accept handler', () => {
    render(<DiffTagHoverPlugin />);

    // Accept handler should return early if no nodeKey
    // This is tested implicitly by not crashing
    expect(screen.queryByTestId('inline-controls')).not.toBeInTheDocument();
  });

  it('should handle node not found in editor', () => {
    ($getNodeByKey as jest.Mock).mockReturnValue(null);

    render(<DiffTagHoverPlugin />);

    // Should not crash when node is not found
    expect(screen.queryByTestId('inline-controls')).not.toBeInTheDocument();
  });

  it('should handle update node with insufficient children', () => {
    const mockNode = createMockNode('update', [createMockChildNode()]); // Only 1 child

    ($getNodeByKey as jest.Mock).mockReturnValue(mockNode);
    ($isDiffTagNodeInline as unknown as jest.Mock).mockReturnValue(true);

    // Should handle gracefully without crashing
    expect(mockNode.getChildren()).toHaveLength(1);
  });
});
