/**
 * Tests for MutationQueuePlugin.tsx
 *
 * Tests the serial mutation queue processing:
 * 1. Processing pending mutations one at a time
 * 2. Calling acceptDiffTag/rejectDiffTag correctly
 * 3. Dispatching completion/failure callbacks
 * 4. Handling edge cases (node not found, errors)
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import MutationQueuePlugin from './MutationQueuePlugin';
import { MutationOp } from '@/reducers/pageLifecycleReducer';

// Mock the Lexical context
jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: jest.fn(),
}));

// Mock diffTagMutations
jest.mock('./diffTagMutations', () => ({
  acceptDiffTag: jest.fn(),
  rejectDiffTag: jest.fn(),
}));

// Mock importExportUtils
jest.mock('./importExportUtils', () => ({
  exportMarkdownReadOnly: jest.fn(),
}));

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { acceptDiffTag, rejectDiffTag } from './diffTagMutations';
import { exportMarkdownReadOnly } from './importExportUtils';

// ============= Test Helpers =============

const createMockEditor = () => {
  return {
    getEditorState: jest.fn(() => ({
      read: jest.fn((fn) => fn()),
    })),
  };
};

const createMutation = (
  id: string,
  type: 'accept' | 'reject',
  nodeKey: string,
  status: 'pending' | 'processing' | 'completed' | 'failed' = 'pending'
): MutationOp => ({
  id,
  type,
  nodeKey,
  status,
});

// ============= Component Initialization Tests =============

describe('MutationQueuePlugin - Initialization', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    (acceptDiffTag as jest.Mock).mockResolvedValue(undefined);
    (rejectDiffTag as jest.Mock).mockResolvedValue(undefined);
    (exportMarkdownReadOnly as jest.Mock).mockReturnValue('# Test content');
  });

  it('should render without crashing and return null', () => {
    const { container } = render(
      <MutationQueuePlugin
        pendingMutations={[]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('should not process when pendingMutations is empty', () => {
    const onStartMutation = jest.fn();

    render(
      <MutationQueuePlugin
        pendingMutations={[]}
        processingMutation={null}
        onStartMutation={onStartMutation}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    expect(onStartMutation).not.toHaveBeenCalled();
    expect(acceptDiffTag).not.toHaveBeenCalled();
    expect(rejectDiffTag).not.toHaveBeenCalled();
  });

  it('should not process when processingMutation is not null', async () => {
    const onStartMutation = jest.fn();
    const existingMutation = createMutation('existing-1', 'accept', 'node-1', 'processing');
    const pendingMutation = createMutation('pending-1', 'accept', 'node-2', 'pending');

    render(
      <MutationQueuePlugin
        pendingMutations={[pendingMutation]}
        processingMutation={existingMutation}
        onStartMutation={onStartMutation}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    // Wait a tick to ensure effect has run
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(onStartMutation).not.toHaveBeenCalled();
  });
});

// ============= Accept Mutation Tests =============

describe('MutationQueuePlugin - Accept Mutations', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    (acceptDiffTag as jest.Mock).mockResolvedValue(undefined);
    (exportMarkdownReadOnly as jest.Mock).mockReturnValue('# Updated content');
  });

  it('should call onStartMutation when processing begins', async () => {
    const onStartMutation = jest.fn();
    const mutation = createMutation('mut-1', 'accept', 'node-123');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={onStartMutation}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onStartMutation).toHaveBeenCalledWith('mut-1');
    });
  });

  it('should call acceptDiffTag with correct arguments', async () => {
    const mutation = createMutation('mut-1', 'accept', 'node-123');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(acceptDiffTag).toHaveBeenCalledWith(mockEditor, 'node-123');
    });
  });

  it('should call onCompleteMutation with new content on success', async () => {
    const onCompleteMutation = jest.fn();
    const mutation = createMutation('mut-1', 'accept', 'node-123');
    (exportMarkdownReadOnly as jest.Mock).mockReturnValue('# New markdown content');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={onCompleteMutation}
        onFailMutation={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onCompleteMutation).toHaveBeenCalledWith('mut-1', '# New markdown content');
    });
  });
});

// ============= Reject Mutation Tests =============

describe('MutationQueuePlugin - Reject Mutations', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    (rejectDiffTag as jest.Mock).mockResolvedValue(undefined);
    (exportMarkdownReadOnly as jest.Mock).mockReturnValue('# Rejected content');
  });

  it('should call rejectDiffTag for reject mutations', async () => {
    const mutation = createMutation('mut-1', 'reject', 'node-456');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(rejectDiffTag).toHaveBeenCalledWith(mockEditor, 'node-456');
    });
  });

  it('should call onCompleteMutation after reject succeeds', async () => {
    const onCompleteMutation = jest.fn();
    const mutation = createMutation('mut-1', 'reject', 'node-456');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={onCompleteMutation}
        onFailMutation={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onCompleteMutation).toHaveBeenCalledWith('mut-1', '# Rejected content');
    });
  });
});

// ============= Error Handling Tests =============

describe('MutationQueuePlugin - Error Handling', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
  });

  it('should call onFailMutation when acceptDiffTag throws', async () => {
    const onFailMutation = jest.fn();
    const mutation = createMutation('mut-1', 'accept', 'node-123');
    (acceptDiffTag as jest.Mock).mockRejectedValue(new Error('Node not found'));

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={jest.fn()}
        onFailMutation={onFailMutation}
      />
    );

    await waitFor(() => {
      expect(onFailMutation).toHaveBeenCalledWith('mut-1', 'Node not found');
    });
  });

  it('should call onFailMutation when rejectDiffTag throws', async () => {
    const onFailMutation = jest.fn();
    const mutation = createMutation('mut-1', 'reject', 'node-456');
    (rejectDiffTag as jest.Mock).mockRejectedValue(new Error('Mutation failed'));

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={jest.fn()}
        onFailMutation={onFailMutation}
      />
    );

    await waitFor(() => {
      expect(onFailMutation).toHaveBeenCalledWith('mut-1', 'Mutation failed');
    });
  });

  it('should handle non-Error objects in catch block', async () => {
    const onFailMutation = jest.fn();
    const mutation = createMutation('mut-1', 'accept', 'node-123');
    (acceptDiffTag as jest.Mock).mockRejectedValue('String error');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={jest.fn()}
        onFailMutation={onFailMutation}
      />
    );

    await waitFor(() => {
      expect(onFailMutation).toHaveBeenCalledWith('mut-1', 'Unknown error');
    });
  });
});

// ============= Queue Processing Tests =============

describe('MutationQueuePlugin - Queue Processing', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    (acceptDiffTag as jest.Mock).mockResolvedValue(undefined);
    (rejectDiffTag as jest.Mock).mockResolvedValue(undefined);
    (exportMarkdownReadOnly as jest.Mock).mockReturnValue('# Content');
  });

  it('should only process the first pending mutation', async () => {
    const onStartMutation = jest.fn();
    const mutation1 = createMutation('mut-1', 'accept', 'node-1');
    const mutation2 = createMutation('mut-2', 'accept', 'node-2');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation1, mutation2]}
        processingMutation={null}
        onStartMutation={onStartMutation}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onStartMutation).toHaveBeenCalledTimes(1);
      expect(onStartMutation).toHaveBeenCalledWith('mut-1');
    });
  });

  it('should skip mutations that are not pending', async () => {
    const onStartMutation = jest.fn();
    const processingMutation = createMutation('mut-1', 'accept', 'node-1', 'processing');
    const pendingMutation = createMutation('mut-2', 'accept', 'node-2', 'pending');

    render(
      <MutationQueuePlugin
        pendingMutations={[processingMutation, pendingMutation]}
        processingMutation={null}
        onStartMutation={onStartMutation}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onStartMutation).toHaveBeenCalledWith('mut-2');
    });
  });

  it('should not start new mutation if one is already processing locally', async () => {
    // This tests the isProcessingRef guard
    const onStartMutation = jest.fn();
    let resolveAccept: () => void;
    const slowAccept = new Promise<void>(resolve => {
      resolveAccept = resolve;
    });
    (acceptDiffTag as jest.Mock).mockReturnValue(slowAccept);

    const mutation = createMutation('mut-1', 'accept', 'node-1');

    const { rerender } = render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={onStartMutation}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    // First call happens
    await waitFor(() => {
      expect(onStartMutation).toHaveBeenCalledTimes(1);
    });

    // Re-render with same props (simulating a parent re-render)
    const mutation2 = createMutation('mut-2', 'accept', 'node-2');
    rerender(
      <MutationQueuePlugin
        pendingMutations={[mutation, mutation2]}
        processingMutation={null}
        onStartMutation={onStartMutation}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    // Should still be 1 because we're still processing the first one
    expect(onStartMutation).toHaveBeenCalledTimes(1);

    // Resolve the first mutation
    resolveAccept!();
  });
});

// ============= Edge Cases Tests =============

describe('MutationQueuePlugin - Edge Cases', () => {
  let mockEditor: ReturnType<typeof createMockEditor>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor = createMockEditor();
    (useLexicalComposerContext as jest.Mock).mockReturnValue([mockEditor]);
    (acceptDiffTag as jest.Mock).mockResolvedValue(undefined);
    (rejectDiffTag as jest.Mock).mockResolvedValue(undefined);
    (exportMarkdownReadOnly as jest.Mock).mockReturnValue('# Content');
  });

  it('should handle empty content from exportMarkdownReadOnly', async () => {
    const onCompleteMutation = jest.fn();
    const mutation = createMutation('mut-1', 'accept', 'node-123');
    (exportMarkdownReadOnly as jest.Mock).mockReturnValue('');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation]}
        processingMutation={null}
        onStartMutation={jest.fn()}
        onCompleteMutation={onCompleteMutation}
        onFailMutation={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(onCompleteMutation).toHaveBeenCalledWith('mut-1', '');
    });
  });

  it('should not process when all mutations have non-pending status', async () => {
    const onStartMutation = jest.fn();
    const mutation1 = createMutation('mut-1', 'accept', 'node-1', 'completed');
    const mutation2 = createMutation('mut-2', 'accept', 'node-2', 'failed');

    render(
      <MutationQueuePlugin
        pendingMutations={[mutation1, mutation2]}
        processingMutation={null}
        onStartMutation={onStartMutation}
        onCompleteMutation={jest.fn()}
        onFailMutation={jest.fn()}
      />
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(onStartMutation).not.toHaveBeenCalled();
  });
});
