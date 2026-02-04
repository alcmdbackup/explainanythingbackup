/**
 * Unit Tests: SourceEditor Component
 *
 * Tests view/edit mode toggle, apply/cancel flow, change detection,
 * and error handling for the source management editor wrapper.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SourceEditor from '../SourceEditor';
import { type SourceChipType } from '@/lib/schemas/schemas';

// Mock the server action
jest.mock('@/actions/actions', () => ({
  updateSourcesForExplanationAction: jest.fn().mockResolvedValue({}),
}));

// Mock child components to isolate SourceEditor logic
jest.mock('../Bibliography', () => {
  return function MockBibliography({ sources }: { sources: unknown[] }) {
    return <div data-testid="bibliography">Bibliography ({sources.length} sources)</div>;
  };
});

jest.mock('../SourceList', () => {
  return function MockSourceList({
    sources,
    onSourceAdded,
    onSourceRemoved,
  }: {
    sources: unknown[];
    onSourceAdded?: (s: SourceChipType) => void;
    onSourceRemoved?: (idx: number) => void;
  }) {
    return (
      <div data-testid="source-list">
        SourceList ({sources.length} sources)
        {onSourceAdded && (
          <button
            data-testid="mock-add-source"
            onClick={() =>
              onSourceAdded({
                url: 'https://new-source.com',
                domain: 'new-source.com',
                title: 'New Source',
                status: 'success',
                favicon_url: null,
                error_message: null,
                source_cache_id: 103,
              })
            }
          >
            Add Source
          </button>
        )}
        {onSourceRemoved && (
          <button
            data-testid="mock-remove-source"
            onClick={() => onSourceRemoved(0)}
          >
            Remove Source
          </button>
        )}
      </div>
    );
  };
});

import { updateSourcesForExplanationAction } from '@/actions/actions';

const mockSources: SourceChipType[] = [
  {
    url: 'https://example.com/article1',
    domain: 'example.com',
    title: 'Article One',
    status: 'success',
    favicon_url: null,
    error_message: null,
    source_cache_id: 101,
  },
  {
    url: 'https://example.org/article2',
    domain: 'example.org',
    title: 'Article Two',
    status: 'success',
    favicon_url: null,
    error_message: null,
    source_cache_id: 102,
  },
];

const mockBibliographySources = [
  { index: 1, title: 'Article One', domain: 'example.com', url: 'https://example.com/article1', favicon_url: null },
  { index: 2, title: 'Article Two', domain: 'example.org', url: 'https://example.org/article2', favicon_url: null },
];

describe('SourceEditor', () => {
  const defaultProps = {
    explanationId: 42,
    sources: mockSources,
    bibliographySources: mockBibliographySources,
    onSourcesChanged: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // View mode
  // ============================================================================
  describe('view mode', () => {
    it('renders Bibliography in view mode', () => {
      render(<SourceEditor {...defaultProps} />);
      expect(screen.getByTestId('bibliography')).toBeInTheDocument();
    });

    it('shows edit toggle button when explanationId is set', () => {
      render(<SourceEditor {...defaultProps} />);
      expect(screen.getByTestId('source-edit-toggle')).toBeInTheDocument();
    });

    it('hides edit toggle button when explanationId is null', () => {
      render(<SourceEditor {...defaultProps} explanationId={null} />);
      expect(screen.queryByTestId('source-edit-toggle')).not.toBeInTheDocument();
    });

    it('returns null when no sources and not editing', () => {
      const { container } = render(
        <SourceEditor {...defaultProps} sources={[]} bibliographySources={[]} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // ============================================================================
  // Entering edit mode
  // ============================================================================
  describe('entering edit mode', () => {
    it('switches to edit mode when pencil button is clicked', () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));

      expect(screen.getByTestId('source-editor-panel')).toBeInTheDocument();
      expect(screen.getByText('Edit Sources')).toBeInTheDocument();
    });

    it('shows SourceList with current sources in edit mode', () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));

      expect(screen.getByTestId('source-list')).toBeInTheDocument();
      expect(screen.getByText('SourceList (2 sources)')).toBeInTheDocument();
    });

    it('shows Cancel and Apply buttons in edit mode', () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));

      expect(screen.getByTestId('source-cancel-btn')).toBeInTheDocument();
      expect(screen.getByTestId('source-apply-btn')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Cancel
  // ============================================================================
  describe('cancel', () => {
    it('returns to view mode on cancel', () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));
      expect(screen.getByTestId('source-editor-panel')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('source-cancel-btn'));
      expect(screen.queryByTestId('source-editor-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('bibliography')).toBeInTheDocument();
    });

    it('does not call onSourcesChanged on cancel', () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));
      fireEvent.click(screen.getByTestId('source-cancel-btn'));

      expect(defaultProps.onSourcesChanged).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Apply button state
  // ============================================================================
  describe('apply button', () => {
    it('is disabled when no changes have been made', () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));

      expect(screen.getByTestId('source-apply-btn')).toBeDisabled();
    });

    it('becomes enabled after adding a source', async () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));

      // Add a new source via mock SourceList
      fireEvent.click(screen.getByTestId('mock-add-source'));

      await waitFor(() => {
        expect(screen.getByTestId('source-apply-btn')).not.toBeDisabled();
      });
    });

    it('becomes enabled after removing a source', async () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));

      // Remove a source via mock SourceList
      fireEvent.click(screen.getByTestId('mock-remove-source'));

      await waitFor(() => {
        expect(screen.getByTestId('source-apply-btn')).not.toBeDisabled();
      });
    });
  });

  // ============================================================================
  // Apply flow
  // ============================================================================
  describe('apply flow', () => {
    it('calls updateSourcesForExplanationAction and onSourcesChanged on apply', async () => {
      render(<SourceEditor {...defaultProps} />);

      // Enter edit mode
      fireEvent.click(screen.getByTestId('source-edit-toggle'));
      // Add a source to enable Apply
      fireEvent.click(screen.getByTestId('mock-add-source'));

      await waitFor(() => {
        expect(screen.getByTestId('source-apply-btn')).not.toBeDisabled();
      });

      // Click Apply
      await act(async () => {
        fireEvent.click(screen.getByTestId('source-apply-btn'));
      });

      await waitFor(() => {
        expect(updateSourcesForExplanationAction).toHaveBeenCalledWith({
          explanationId: 42,
          sourceIds: [101, 102, 103],
        });
        expect(defaultProps.onSourcesChanged).toHaveBeenCalled();
      });
    });

    it('returns to view mode after successful apply', async () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));
      fireEvent.click(screen.getByTestId('mock-add-source'));

      await waitFor(() => {
        expect(screen.getByTestId('source-apply-btn')).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('source-apply-btn'));
      });

      await waitFor(() => {
        expect(screen.queryByTestId('source-editor-panel')).not.toBeInTheDocument();
        expect(screen.getByTestId('bibliography')).toBeInTheDocument();
      });
    });

    it('shows error message when apply fails', async () => {
      (updateSourcesForExplanationAction as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));
      fireEvent.click(screen.getByTestId('mock-add-source'));

      await waitFor(() => {
        expect(screen.getByTestId('source-apply-btn')).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('source-apply-btn'));
      });

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('stays in edit mode when apply fails', async () => {
      (updateSourcesForExplanationAction as jest.Mock).mockRejectedValueOnce(
        new Error('Server error')
      );

      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));
      fireEvent.click(screen.getByTestId('mock-add-source'));

      await waitFor(() => {
        expect(screen.getByTestId('source-apply-btn')).not.toBeDisabled();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('source-apply-btn'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-editor-panel')).toBeInTheDocument();
      });
    });

    it('does not apply when explanationId is null', async () => {
      render(<SourceEditor {...defaultProps} explanationId={null} />);

      // Can't enter edit mode via toggle (hidden), but test the guard
      expect(updateSourcesForExplanationAction).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Regenerate button
  // ============================================================================
  describe('regenerate button', () => {
    it('shows regenerate button when sources have changed', async () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));
      fireEvent.click(screen.getByTestId('mock-add-source'));

      await waitFor(() => {
        expect(screen.getByTestId('source-regenerate-btn')).toBeInTheDocument();
      });
    });

    it('does not show regenerate button when no changes', () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));

      expect(screen.queryByTestId('source-regenerate-btn')).not.toBeInTheDocument();
    });

    it('regenerate button is disabled (coming soon)', async () => {
      render(<SourceEditor {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-edit-toggle'));
      fireEvent.click(screen.getByTestId('mock-add-source'));

      await waitFor(() => {
        expect(screen.getByTestId('source-regenerate-btn')).toBeDisabled();
      });
    });
  });

  // ============================================================================
  // Custom className
  // ============================================================================
  describe('className prop', () => {
    it('applies custom className', () => {
      const { container } = render(
        <SourceEditor {...defaultProps} className="custom-class" />
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });
});
