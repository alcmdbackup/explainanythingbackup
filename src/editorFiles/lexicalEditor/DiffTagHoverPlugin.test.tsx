/**
 * Tests for DiffTagHoverPlugin.tsx
 * Tests event delegation for accept/reject and pending suggestions tracking
 *
 * The simplified architecture uses:
 * 1. Event delegation on editor root for accept/reject clicks
 * 2. Direct Lexical state reading via $nodesOfType for counting pending suggestions
 * 3. No DOM querying or React portals
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import DiffTagHoverPlugin from './DiffTagHoverPlugin';

// Mock the Lexical context and modules
jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: jest.fn(),
}));

const mockNodesOfType = jest.fn();
jest.mock('lexical', () => ({
  $nodesOfType: (...args: unknown[]) => mockNodesOfType(...args),
}));

jest.mock('./DiffTagNode', () => ({
  DiffTagNodeInline: class DiffTagNodeInline {},
  DiffTagNodeBlock: class DiffTagNodeBlock {},
}));

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

// ============= Test Helpers =============

const createMockEditor = () => {
  let updateCallback: (() => void) | null = null;
  const rootElement = document.createElement('div');

  return {
    registerUpdateListener: jest.fn((callback) => {
      updateCallback = callback;
      return jest.fn(); // return unsubscribe function
    }),
    getEditorState: jest.fn(() => ({
      read: jest.fn((fn) => fn()),
    })),
    getRootElement: jest.fn(() => rootElement),
    _rootElement: rootElement,
    _triggerUpdate: () => {
      if (updateCallback) {
        updateCallback();
      }
    },
  };
};

// ============= Component Initialization Tests =============

describe('DiffTagHoverPlugin - Initialization', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    mockNodesOfType.mockReturnValue([]);
  });

  it('should render without crashing and return null', () => {
    const { container } = render(<DiffTagHoverPlugin />);
    // Component returns null, so container should be empty
    expect(container.firstChild).toBeNull();
  });

  it('should register update listener', () => {
    render(<DiffTagHoverPlugin />);
    expect(mockEditor.registerUpdateListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should cleanup listener on unmount', () => {
    const unsubscribe = jest.fn();
    mockEditor.registerUpdateListener.mockReturnValue(unsubscribe);

    const { unmount } = render(<DiffTagHoverPlugin />);
    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it('should add click event listener to root element', () => {
    const addEventListenerSpy = jest.spyOn(mockEditor._rootElement, 'addEventListener');

    render(<DiffTagHoverPlugin />);

    expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
    addEventListenerSpy.mockRestore();
  });

  it('should remove click event listener on unmount', () => {
    const removeEventListenerSpy = jest.spyOn(mockEditor._rootElement, 'removeEventListener');

    const { unmount } = render(<DiffTagHoverPlugin />);
    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function));
    removeEventListenerSpy.mockRestore();
  });
});

// ============= Pending Suggestions Tracking Tests =============

describe('DiffTagHoverPlugin - Pending Suggestions Tracking', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  it('should call onPendingSuggestionsChange with false when no diff tags', async () => {
    const onPendingSuggestionsChange = jest.fn();
    mockNodesOfType.mockReturnValue([]);

    render(<DiffTagHoverPlugin onPendingSuggestionsChange={onPendingSuggestionsChange} />);

    await waitFor(() => {
      expect(onPendingSuggestionsChange).toHaveBeenCalledWith(false);
    });
  });

  it('should call onPendingSuggestionsChange with true when diff tags exist', async () => {
    const onPendingSuggestionsChange = jest.fn();
    mockNodesOfType
      .mockReturnValueOnce([{ __key: 'node-1' }]) // inline nodes
      .mockReturnValueOnce([]); // block nodes

    render(<DiffTagHoverPlugin onPendingSuggestionsChange={onPendingSuggestionsChange} />);

    await waitFor(() => {
      expect(onPendingSuggestionsChange).toHaveBeenCalledWith(true);
    });
  });

  it('should count both inline and block diff tags', async () => {
    const onPendingSuggestionsChange = jest.fn();
    mockNodesOfType
      .mockReturnValueOnce([{ __key: 'node-1' }]) // inline nodes
      .mockReturnValueOnce([{ __key: 'node-2' }]); // block nodes

    render(<DiffTagHoverPlugin onPendingSuggestionsChange={onPendingSuggestionsChange} />);

    await waitFor(() => {
      expect(onPendingSuggestionsChange).toHaveBeenCalledWith(true);
    });
  });

  it('should update pending count on editor updates', async () => {
    const onPendingSuggestionsChange = jest.fn();

    // Initial state: no nodes
    mockNodesOfType.mockReturnValue([]);

    render(<DiffTagHoverPlugin onPendingSuggestionsChange={onPendingSuggestionsChange} />);

    // After first render, should be false
    await waitFor(() => {
      expect(onPendingSuggestionsChange).toHaveBeenCalledWith(false);
    });

    // Simulate nodes appearing
    mockNodesOfType
      .mockReturnValueOnce([{ __key: 'node-1' }])
      .mockReturnValueOnce([]);

    // Trigger update
    mockEditor._triggerUpdate();

    await waitFor(() => {
      expect(onPendingSuggestionsChange).toHaveBeenCalledWith(true);
    });
  });
});

// ============= Event Delegation Tests =============

describe('DiffTagHoverPlugin - Event Delegation', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    mockNodesOfType.mockReturnValue([]);
  });

  it('should call onQueueMutation with accept when accept button is clicked', () => {
    const onQueueMutation = jest.fn();
    render(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} />);

    // Create a button with data attributes
    const acceptBtn = document.createElement('button');
    acceptBtn.setAttribute('data-action', 'accept');
    acceptBtn.setAttribute('data-node-key', 'node-123');
    mockEditor._rootElement.appendChild(acceptBtn);

    // Dispatch click event
    const clickEvent = new MouseEvent('click', { bubbles: true });
    acceptBtn.dispatchEvent(clickEvent);

    expect(onQueueMutation).toHaveBeenCalledWith('node-123', 'accept');
    mockEditor._rootElement.removeChild(acceptBtn);
  });

  it('should call onQueueMutation with reject when reject button is clicked', () => {
    const onQueueMutation = jest.fn();
    render(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} />);

    // Create a button with data attributes
    const rejectBtn = document.createElement('button');
    rejectBtn.setAttribute('data-action', 'reject');
    rejectBtn.setAttribute('data-node-key', 'node-456');
    mockEditor._rootElement.appendChild(rejectBtn);

    // Dispatch click event
    const clickEvent = new MouseEvent('click', { bubbles: true });
    rejectBtn.dispatchEvent(clickEvent);

    expect(onQueueMutation).toHaveBeenCalledWith('node-456', 'reject');
    mockEditor._rootElement.removeChild(rejectBtn);
  });

  it('should not call onQueueMutation for clicks without data attributes', () => {
    const onQueueMutation = jest.fn();
    render(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} />);

    // Create a regular element without data attributes
    const otherElement = document.createElement('span');
    mockEditor._rootElement.appendChild(otherElement);

    // Dispatch click event
    const clickEvent = new MouseEvent('click', { bubbles: true });
    otherElement.dispatchEvent(clickEvent);

    expect(onQueueMutation).not.toHaveBeenCalled();
    mockEditor._rootElement.removeChild(otherElement);
  });

  it('should not call onQueueMutation for elements with only action attribute', () => {
    const onQueueMutation = jest.fn();
    render(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} />);

    // Create element with only action, no node-key
    const element = document.createElement('button');
    element.setAttribute('data-action', 'accept');
    // Missing data-node-key
    mockEditor._rootElement.appendChild(element);

    const clickEvent = new MouseEvent('click', { bubbles: true });
    element.dispatchEvent(clickEvent);

    expect(onQueueMutation).not.toHaveBeenCalled();
    mockEditor._rootElement.removeChild(element);
  });

  it('should not call onQueueMutation for elements with only node-key attribute', () => {
    const onQueueMutation = jest.fn();
    render(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} />);

    // Create element with only node-key, no action
    const element = document.createElement('button');
    element.setAttribute('data-node-key', 'node-123');
    // Missing data-action
    mockEditor._rootElement.appendChild(element);

    const clickEvent = new MouseEvent('click', { bubbles: true });
    element.dispatchEvent(clickEvent);

    expect(onQueueMutation).not.toHaveBeenCalled();
    mockEditor._rootElement.removeChild(element);
  });

  it('should prevent default and stop propagation on button click', () => {
    const onQueueMutation = jest.fn();
    render(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} />);

    const acceptBtn = document.createElement('button');
    acceptBtn.setAttribute('data-action', 'accept');
    acceptBtn.setAttribute('data-node-key', 'node-789');
    mockEditor._rootElement.appendChild(acceptBtn);

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const preventDefaultSpy = jest.spyOn(clickEvent, 'preventDefault');
    const stopPropagationSpy = jest.spyOn(clickEvent, 'stopPropagation');

    acceptBtn.dispatchEvent(clickEvent);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
    mockEditor._rootElement.removeChild(acceptBtn);
  });

  it('should work without onQueueMutation callback', () => {
    render(<DiffTagHoverPlugin />);

    const acceptBtn = document.createElement('button');
    acceptBtn.setAttribute('data-action', 'accept');
    acceptBtn.setAttribute('data-node-key', 'node-123');
    mockEditor._rootElement.appendChild(acceptBtn);

    // Should not throw
    const clickEvent = new MouseEvent('click', { bubbles: true });
    expect(() => acceptBtn.dispatchEvent(clickEvent)).not.toThrow();

    mockEditor._rootElement.removeChild(acceptBtn);
  });
});

// ============= Edge Cases Tests =============

describe('DiffTagHoverPlugin - Edge Cases', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    mockNodesOfType.mockReturnValue([]);
  });

  it('should handle null root element gracefully', () => {
    mockEditor.getRootElement.mockReturnValue(null as unknown as HTMLDivElement);

    // Should not throw
    expect(() => render(<DiffTagHoverPlugin />)).not.toThrow();
  });

  it('should handle unknown action gracefully', () => {
    const onQueueMutation = jest.fn();
    render(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} />);

    const unknownBtn = document.createElement('button');
    unknownBtn.setAttribute('data-action', 'unknown-action');
    unknownBtn.setAttribute('data-node-key', 'node-123');
    mockEditor._rootElement.appendChild(unknownBtn);

    // Should not throw
    const clickEvent = new MouseEvent('click', { bubbles: true });
    expect(() => unknownBtn.dispatchEvent(clickEvent)).not.toThrow();

    expect(onQueueMutation).not.toHaveBeenCalled();
    mockEditor._rootElement.removeChild(unknownBtn);
  });

  it('should work without onPendingSuggestionsChange callback', () => {
    mockNodesOfType.mockReturnValue([{ __key: 'node-1' }]);

    // Should not throw when callback is not provided
    expect(() => render(<DiffTagHoverPlugin />)).not.toThrow();
  });
});

// ============= isProcessing Tests =============

describe('DiffTagHoverPlugin - isProcessing', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    mockNodesOfType.mockReturnValue([]);
  });

  it('should not call onQueueMutation when isProcessing is true', () => {
    const onQueueMutation = jest.fn();
    render(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} isProcessing={true} />);

    const acceptBtn = document.createElement('button');
    acceptBtn.setAttribute('data-action', 'accept');
    acceptBtn.setAttribute('data-node-key', 'node-123');
    mockEditor._rootElement.appendChild(acceptBtn);

    const clickEvent = new MouseEvent('click', { bubbles: true });
    acceptBtn.dispatchEvent(clickEvent);

    expect(onQueueMutation).not.toHaveBeenCalled();
    mockEditor._rootElement.removeChild(acceptBtn);
  });

  it('should disable buttons when isProcessing is true', () => {
    const acceptBtn = document.createElement('button');
    acceptBtn.setAttribute('data-action', 'accept');
    acceptBtn.setAttribute('data-node-key', 'node-123');
    mockEditor._rootElement.appendChild(acceptBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.setAttribute('data-action', 'reject');
    rejectBtn.setAttribute('data-node-key', 'node-456');
    mockEditor._rootElement.appendChild(rejectBtn);

    render(<DiffTagHoverPlugin isProcessing={true} />);

    expect(acceptBtn.disabled).toBe(true);
    expect(acceptBtn.style.opacity).toBe('0.5');
    expect(acceptBtn.style.cursor).toBe('not-allowed');

    expect(rejectBtn.disabled).toBe(true);
    expect(rejectBtn.style.opacity).toBe('0.5');
    expect(rejectBtn.style.cursor).toBe('not-allowed');

    mockEditor._rootElement.removeChild(acceptBtn);
    mockEditor._rootElement.removeChild(rejectBtn);
  });

  it('should enable buttons when isProcessing is false', () => {
    const acceptBtn = document.createElement('button');
    acceptBtn.setAttribute('data-action', 'accept');
    acceptBtn.setAttribute('data-node-key', 'node-123');
    mockEditor._rootElement.appendChild(acceptBtn);

    render(<DiffTagHoverPlugin isProcessing={false} />);

    expect(acceptBtn.disabled).toBe(false);
    expect(acceptBtn.style.opacity).toBe('1');
    expect(acceptBtn.style.cursor).toBe('pointer');

    mockEditor._rootElement.removeChild(acceptBtn);
  });

  it('should re-enable buttons when isProcessing changes from true to false', () => {
    const acceptBtn = document.createElement('button');
    acceptBtn.setAttribute('data-action', 'accept');
    acceptBtn.setAttribute('data-node-key', 'node-123');
    mockEditor._rootElement.appendChild(acceptBtn);

    const { rerender } = render(<DiffTagHoverPlugin isProcessing={true} />);

    expect(acceptBtn.disabled).toBe(true);

    rerender(<DiffTagHoverPlugin isProcessing={false} />);

    expect(acceptBtn.disabled).toBe(false);
    expect(acceptBtn.style.opacity).toBe('1');
    expect(acceptBtn.style.cursor).toBe('pointer');

    mockEditor._rootElement.removeChild(acceptBtn);
  });

  it('should call onQueueMutation when isProcessing changes to false', () => {
    const onQueueMutation = jest.fn();

    const acceptBtn = document.createElement('button');
    acceptBtn.setAttribute('data-action', 'accept');
    acceptBtn.setAttribute('data-node-key', 'node-123');
    mockEditor._rootElement.appendChild(acceptBtn);

    const { rerender } = render(
      <DiffTagHoverPlugin onQueueMutation={onQueueMutation} isProcessing={true} />
    );

    // Click while processing - should not fire
    const clickEvent1 = new MouseEvent('click', { bubbles: true });
    acceptBtn.dispatchEvent(clickEvent1);
    expect(onQueueMutation).not.toHaveBeenCalled();

    // Re-enable processing
    rerender(<DiffTagHoverPlugin onQueueMutation={onQueueMutation} isProcessing={false} />);

    // Click after enabling - should fire
    const clickEvent2 = new MouseEvent('click', { bubbles: true });
    acceptBtn.dispatchEvent(clickEvent2);
    expect(onQueueMutation).toHaveBeenCalledWith('node-123', 'accept');

    mockEditor._rootElement.removeChild(acceptBtn);
  });
});
