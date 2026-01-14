/**
 * AdvancedAIEditorModal tests - verifies dynamic header and layout
 */

import { render, screen, fireEvent } from '@testing-library/react';
import AdvancedAIEditorModal from './AdvancedAIEditorModal';
import type { TagModeState, TagModeAction } from '@/reducers/tagModeReducer';

describe('AdvancedAIEditorModal', () => {
  const mockTagState: TagModeState = {
    mode: 'normal',
    tags: [],
    originalTags: [],
    showRegenerateDropdown: false
  };
  const mockDispatch = jest.fn() as jest.MockedFunction<React.Dispatch<TagModeAction>>;
  const mockOnClose = jest.fn();
  const mockOnApply = jest.fn();

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    initialPrompt: '',
    initialSources: [],
    initialOutputMode: 'inline-diff' as const,
    tagState: mockTagState,
    dispatchTagAction: mockDispatch,
    onApply: mockOnApply
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Dynamic Header', () => {
    it('should show "Suggest edits" when outputMode is inline-diff', () => {
      render(<AdvancedAIEditorModal {...defaultProps} initialOutputMode="inline-diff" />);

      expect(screen.getByText('Suggest edits')).toBeInTheDocument();
    });

    it('should show "Rewrite article" when outputMode is rewrite', () => {
      render(<AdvancedAIEditorModal {...defaultProps} initialOutputMode="rewrite" />);

      expect(screen.getByText('Rewrite article')).toBeInTheDocument();
    });

    it('should update header when output mode toggle is changed', () => {
      render(<AdvancedAIEditorModal {...defaultProps} initialOutputMode="inline-diff" />);

      // Initially shows suggest
      expect(screen.getByText('Suggest edits')).toBeInTheDocument();

      // Click rewrite button
      const rewriteButton = screen.getByTestId('output-mode-rewrite');
      fireEvent.click(rewriteButton);

      // Now shows rewrite
      expect(screen.getByText('Rewrite article')).toBeInTheDocument();
    });
  });

  describe('OutputModeToggle Position', () => {
    it('should render OutputModeToggle in header section', () => {
      render(<AdvancedAIEditorModal {...defaultProps} />);

      // OutputModeToggle should be present
      expect(screen.getByTestId('output-mode-toggle')).toBeInTheDocument();

      // Both mode buttons should be present
      expect(screen.getByTestId('output-mode-inline-diff')).toBeInTheDocument();
      expect(screen.getByTestId('output-mode-rewrite')).toBeInTheDocument();
    });
  });

  describe('Modal Visibility', () => {
    it('should render when isOpen is true', () => {
      render(<AdvancedAIEditorModal {...defaultProps} isOpen={true} />);

      expect(screen.getByTestId('advanced-ai-modal')).toBeInTheDocument();
    });

    it('should not render when isOpen is false', () => {
      render(<AdvancedAIEditorModal {...defaultProps} isOpen={false} />);

      expect(screen.queryByTestId('advanced-ai-modal')).not.toBeInTheDocument();
    });
  });

  describe('Close Behavior', () => {
    it('should call onClose when X button is clicked with no changes', () => {
      render(<AdvancedAIEditorModal {...defaultProps} />);

      const closeButton = screen.getByTestId('modal-cancel-button');
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
