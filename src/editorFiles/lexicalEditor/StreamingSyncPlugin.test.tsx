/**
 * Tests for StreamingSyncPlugin.tsx
 *
 * Tests the streaming content sync behavior:
 * 1. Immediate updates when not streaming
 * 2. Debounced updates (100ms) when streaming
 * 3. Duplicate content prevention
 * 4. Cleanup on unmount
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { StreamingSyncPlugin } from './StreamingSyncPlugin';

// Mock the Lexical context
jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: jest.fn(),
}));

// Mock importExportUtils
jest.mock('./importExportUtils', () => ({
  preprocessCriticMarkup: jest.fn((content: string) => content),
  replaceBrTagsWithNewlines: jest.fn(),
  MARKDOWN_TRANSFORMERS: [],
}));

// Mock @lexical/markdown
jest.mock('@lexical/markdown', () => ({
  $convertFromMarkdownString: jest.fn(),
}));

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { preprocessCriticMarkup, replaceBrTagsWithNewlines } from './importExportUtils';
import { $convertFromMarkdownString } from '@lexical/markdown';

// ============= Test Helpers =============

const createMockEditor = () => {
  return {
    update: jest.fn((callback: () => void) => {
      callback();
    }),
  };
};

// ============= Initialization Tests =============

describe('StreamingSyncPlugin - Initialization', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should render without crashing and return null', () => {
    const { container } = render(
      <StreamingSyncPlugin content="" isStreaming={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should not update when content is empty string (initial state)', () => {
    render(<StreamingSyncPlugin content="" isStreaming={false} />);

    // No update should happen for initial empty content
    // (lastContentRef starts as '' so it matches)
    expect(mockEditor.update).not.toHaveBeenCalled();
  });
});

// ============= Content Updates (not streaming) Tests =============

describe('StreamingSyncPlugin - Content Updates (not streaming)', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should update immediately when content changes', () => {
    render(<StreamingSyncPlugin content="# Hello" isStreaming={false} />);

    expect(mockEditor.update).toHaveBeenCalledTimes(1);
  });

  it('should call preprocessCriticMarkup with content', () => {
    render(<StreamingSyncPlugin content="# Test content" isStreaming={false} />);

    expect(preprocessCriticMarkup).toHaveBeenCalledWith('# Test content');
  });

  it('should call $convertFromMarkdownString with preprocessed markdown', () => {
    (preprocessCriticMarkup as jest.Mock).mockReturnValue('# Preprocessed');

    render(<StreamingSyncPlugin content="# Test" isStreaming={false} />);

    expect($convertFromMarkdownString).toHaveBeenCalledWith('# Preprocessed', []);
  });

  it('should call replaceBrTagsWithNewlines', () => {
    render(<StreamingSyncPlugin content="# Test" isStreaming={false} />);

    expect(replaceBrTagsWithNewlines).toHaveBeenCalled();
  });

  it('should update immediately on content change (no debounce)', () => {
    const { rerender } = render(
      <StreamingSyncPlugin content="# First" isStreaming={false} />
    );

    expect(mockEditor.update).toHaveBeenCalledTimes(1);

    rerender(<StreamingSyncPlugin content="# Second" isStreaming={false} />);

    expect(mockEditor.update).toHaveBeenCalledTimes(2);
  });
});

// ============= Debounce (streaming) Tests =============

describe('StreamingSyncPlugin - Debounce (streaming)', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should not update immediately when streaming', () => {
    render(<StreamingSyncPlugin content="# Streaming content" isStreaming={true} />);

    expect(mockEditor.update).not.toHaveBeenCalled();
  });

  it('should update after 100ms when streaming', () => {
    render(<StreamingSyncPlugin content="# Streaming content" isStreaming={true} />);

    expect(mockEditor.update).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockEditor.update).toHaveBeenCalledTimes(1);
  });

  it('should cancel pending timeout on new content', () => {
    const { rerender } = render(
      <StreamingSyncPlugin content="# First" isStreaming={true} />
    );

    act(() => {
      jest.advanceTimersByTime(50);
    });

    expect(mockEditor.update).not.toHaveBeenCalled();

    // New content should cancel the previous timeout
    rerender(<StreamingSyncPlugin content="# Second" isStreaming={true} />);

    act(() => {
      jest.advanceTimersByTime(50);
    });

    // Still not called - new timeout hasn't completed
    expect(mockEditor.update).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(50);
    });

    // Now it should be called with the latest content
    expect(mockEditor.update).toHaveBeenCalledTimes(1);
    expect(preprocessCriticMarkup).toHaveBeenLastCalledWith('# Second');
  });

  it('should use latest content when debounce fires', () => {
    const { rerender } = render(
      <StreamingSyncPlugin content="# Content 1" isStreaming={true} />
    );

    rerender(<StreamingSyncPlugin content="# Content 2" isStreaming={true} />);
    rerender(<StreamingSyncPlugin content="# Content 3" isStreaming={true} />);

    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Should only update once with the final content
    expect(mockEditor.update).toHaveBeenCalledTimes(1);
    expect(preprocessCriticMarkup).toHaveBeenLastCalledWith('# Content 3');
  });
});

// ============= Duplicate Prevention Tests =============

describe('StreamingSyncPlugin - Duplicate Prevention', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should skip update when content unchanged', () => {
    const { rerender } = render(
      <StreamingSyncPlugin content="# Same content" isStreaming={false} />
    );

    expect(mockEditor.update).toHaveBeenCalledTimes(1);

    // Rerender with same content
    rerender(<StreamingSyncPlugin content="# Same content" isStreaming={false} />);

    expect(mockEditor.update).toHaveBeenCalledTimes(1);
  });

  it('should update when content changes after duplicate', () => {
    const { rerender } = render(
      <StreamingSyncPlugin content="# First" isStreaming={false} />
    );

    expect(mockEditor.update).toHaveBeenCalledTimes(1);

    rerender(<StreamingSyncPlugin content="# First" isStreaming={false} />);
    expect(mockEditor.update).toHaveBeenCalledTimes(1);

    rerender(<StreamingSyncPlugin content="# Different" isStreaming={false} />);
    expect(mockEditor.update).toHaveBeenCalledTimes(2);
  });
});

// ============= Cleanup Tests =============

describe('StreamingSyncPlugin - Cleanup', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should clear timeout on unmount', () => {
    const { unmount } = render(
      <StreamingSyncPlugin content="# Test" isStreaming={true} />
    );

    expect(mockEditor.update).not.toHaveBeenCalled();

    unmount();

    act(() => {
      jest.advanceTimersByTime(100);
    });

    // Should not update after unmount
    expect(mockEditor.update).not.toHaveBeenCalled();
  });

  it('should clear timeout when content changes during streaming', () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    const { rerender } = render(
      <StreamingSyncPlugin content="# First" isStreaming={true} />
    );

    // Content change should trigger clearTimeout
    rerender(<StreamingSyncPlugin content="# Second" isStreaming={true} />);

    expect(clearTimeoutSpy).toHaveBeenCalled();

    clearTimeoutSpy.mockRestore();
  });
});

// ============= Edge Cases Tests =============

describe('StreamingSyncPlugin - Edge Cases', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should handle transition from streaming to not streaming', () => {
    const { rerender } = render(
      <StreamingSyncPlugin content="# Content" isStreaming={true} />
    );

    expect(mockEditor.update).not.toHaveBeenCalled();

    // Switch to not streaming with new content
    rerender(<StreamingSyncPlugin content="# Final content" isStreaming={false} />);

    // Should update immediately
    expect(mockEditor.update).toHaveBeenCalledTimes(1);
    expect(preprocessCriticMarkup).toHaveBeenLastCalledWith('# Final content');
  });

  it('should handle transition from not streaming to streaming', () => {
    const { rerender } = render(
      <StreamingSyncPlugin content="# Initial" isStreaming={false} />
    );

    expect(mockEditor.update).toHaveBeenCalledTimes(1);

    // Switch to streaming with new content
    rerender(<StreamingSyncPlugin content="# Streaming" isStreaming={true} />);

    // Should not update immediately
    expect(mockEditor.update).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockEditor.update).toHaveBeenCalledTimes(2);
  });

  it('should handle empty content after non-empty content', () => {
    const { rerender } = render(
      <StreamingSyncPlugin content="# Content" isStreaming={false} />
    );

    expect(mockEditor.update).toHaveBeenCalledTimes(1);

    rerender(<StreamingSyncPlugin content="" isStreaming={false} />);

    expect(mockEditor.update).toHaveBeenCalledTimes(2);
    expect(preprocessCriticMarkup).toHaveBeenLastCalledWith('');
  });
});
