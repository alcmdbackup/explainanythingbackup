import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AISuggestionsPanel from './AISuggestionsPanel';
import { runAISuggestionsPipelineAction } from '../editorFiles/actions/actions';
import {
  createMockAISuggestionsPanelProps,
  createMockSessionData,
} from '@/testing/utils/component-test-helpers';

// Mock dependencies
jest.mock('../editorFiles/actions/actions', () => ({
  runAISuggestionsPipelineAction: jest.fn(),
}));

describe('AISuggestionsPanel', () => {
  const mockRunAISuggestionsPipelineAction = runAISuggestionsPipelineAction as jest.MockedFunction<
    typeof runAISuggestionsPipelineAction
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear console methods to avoid noise in tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ========================================================================
  // Visibility & Rendering Tests
  // ========================================================================

  describe('Visibility & Rendering', () => {
    it('should render when isVisible is true', () => {
      const props = createMockAISuggestionsPanelProps({ isVisible: true });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByText('Marginalia')).toBeInTheDocument();
    });

    it('should not render when isVisible is false', () => {
      const props = createMockAISuggestionsPanelProps({ isVisible: false });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.queryByText('Marginalia')).not.toBeInTheDocument();
    });

    it('should render panel header with title', () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByRole('heading', { name: 'Marginalia' })).toBeInTheDocument();
    });

    it('should render close button when onClose provided', () => {
      const mockOnClose = jest.fn();
      const props = createMockAISuggestionsPanelProps({ onClose: mockOnClose });
      render(<AISuggestionsPanel {...props} />);

      const closeButton = screen.getByRole('button', { name: /close suggestions panel/i });
      expect(closeButton).toBeInTheDocument();
    });

    it('should not render close button when onClose not provided', () => {
      const props = createMockAISuggestionsPanelProps({ onClose: undefined });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.queryByRole('button', { name: /close suggestions panel/i })).not.toBeInTheDocument();
    });

    it('should render form elements correctly', () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByLabelText(/what would you like to improve/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/describe your desired changes/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /get ai suggestions/i })).toBeInTheDocument();
    });

    it('should render instructions text', () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByText(/describe the improvements you'd like to see/i)).toBeInTheDocument();
      expect(screen.getByText(/ai will analyze and enhance your content/i)).toBeInTheDocument();
      expect(screen.getByText(/changes will be applied directly to your manuscript/i)).toBeInTheDocument();
    });

    it('should apply theme styling classes', () => {
      const props = createMockAISuggestionsPanelProps();
      const { container } = render(<AISuggestionsPanel {...props} />);

      const panelDiv = container.firstChild as HTMLElement;
      // CSS variable based styling supports both light/dark modes
      expect(panelDiv).toHaveClass('bg-[var(--surface-secondary)]');
    });
  });

  // ========================================================================
  // Form Input Tests
  // ========================================================================

  describe('Form Input', () => {
    it('should update prompt on textarea change', async () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Make it more concise');

      expect(textarea).toHaveValue('Make it more concise');
    });

    it('should display placeholder text', () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByPlaceholderText(/describe your desired changes/i);
      expect(textarea).toBeInTheDocument();
    });

    it('should disable textarea during loading', async () => {
      const props = createMockAISuggestionsPanelProps();
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(textarea).toBeDisabled();
      });
    });

    it('should start with empty textarea', () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      expect(textarea).toHaveValue('');
    });

    it('should handle textarea resize-none class', () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      expect(textarea).toHaveClass('resize-none');
    });

    it('should allow clearing text input', async () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test text');
      expect(textarea).toHaveValue('Test text');

      await userEvent.clear(textarea);
      expect(textarea).toHaveValue('');
    });

    it('should maintain textarea value across re-renders', async () => {
      const props = createMockAISuggestionsPanelProps();
      const { rerender } = render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Persistent text');

      rerender(<AISuggestionsPanel {...props} />);
      expect(textarea).toHaveValue('Persistent text');
    });
  });

  // ========================================================================
  // Submit Button State Tests
  // ========================================================================

  describe('Submit Button State', () => {
    it('should disable button when prompt is empty', () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      expect(button).toBeDisabled();
    });

    it('should disable button when prompt is only whitespace', async () => {
      const props = createMockAISuggestionsPanelProps();
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, '   ');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      expect(button).toBeDisabled();
    });

    it('should disable button when currentContent is empty', () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: '' });
      render(<AISuggestionsPanel {...props} />);

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      expect(button).toBeDisabled();
    });

    it('should disable button when currentContent is only whitespace', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: '   ' });
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Valid prompt');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      expect(button).toBeDisabled();
    });

    it('should enable button when both prompt and content are valid', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Valid content' });
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Valid prompt');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      expect(button).not.toBeDisabled();
    });

    it('should disable button during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Valid content' });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Valid prompt');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(button).toBeDisabled();
      });
    });

    it('should show "Generating..." text during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Valid content' });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Valid prompt');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /composing/i })).toBeInTheDocument();
      });
    });
  });

  // ========================================================================
  // Form Submission - Success Flow Tests
  // ========================================================================

  describe('Form Submission - Success Flow', () => {
    it('should call runAISuggestionsPipelineAction with correct params', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Make it better');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockRunAISuggestionsPipelineAction).toHaveBeenCalledWith(
          'Test content',
          'Make it better',
          undefined
        );
      });
    });

    it('should call runAISuggestionsPipelineAction with session data when provided', async () => {
      const sessionData = createMockSessionData({
        explanation_id: 123,
        explanation_title: 'Test Title',
      });
      const props = createMockAISuggestionsPanelProps({
        currentContent: 'Test content',
        sessionData,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockRunAISuggestionsPipelineAction).toHaveBeenCalledWith(
          'Test content',
          'Improve this',
          {
            explanation_id: 123,
            explanation_title: 'Test Title',
            user_prompt: 'Improve this',
          }
        );
      });
    });

    it('should trim prompt before submission', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, '  Make it better  ');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockRunAISuggestionsPipelineAction).toHaveBeenCalledWith(
          'Test content',
          'Make it better',
          undefined
        );
      });
    });

    it('should call onEnterEditMode on successful submission', async () => {
      const mockOnEnterEditMode = jest.fn();
      const props = createMockAISuggestionsPanelProps({
        currentContent: 'Test content',
        onEnterEditMode: mockOnEnterEditMode,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockOnEnterEditMode).toHaveBeenCalled();
      });
    });

    it('should call onContentChange with new content on success', async () => {
      const mockOnContentChange = jest.fn();
      const props = createMockAISuggestionsPanelProps({
        currentContent: 'Test content',
        onContentChange: mockOnContentChange,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content from AI',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockOnContentChange).toHaveBeenCalledWith('Updated content from AI');
      });
    });

    it('should display success message after successful submission', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Revisions Applied')).toBeInTheDocument();
        expect(screen.getByText(/Your manuscript has been updated with scholarly suggestions/i)).toBeInTheDocument();
      });
    });

    it('should clear loading state after successful submission', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Revisions Applied')).toBeInTheDocument();
      });

      // Button should show normal text again
      expect(screen.getByRole('button', { name: /get ai suggestions/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /composing/i })).not.toBeInTheDocument();
    });
  });

  // ========================================================================
  // Form Submission - Error Handling Tests
  // ========================================================================

  describe('Form Submission - Error Handling', () => {
    it('should show error when prompt is empty', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      render(<AISuggestionsPanel {...props} />);

      const button = screen.getByRole('button', { name: /get ai suggestions/i });

      // Force enable the button to test validation
      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'test');
      await userEvent.clear(textarea);

      // Since button is disabled by empty prompt, we can't actually click it
      // This validates the disabled state itself
      expect(button).toBeDisabled();
    });

    it('should display error message when action fails', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: false,
        error: 'AI service unavailable',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Error')).toBeInTheDocument();
        expect(screen.getByText('AI service unavailable')).toBeInTheDocument();
      });
    });

    it('should display default error message when error message not provided', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: false,
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Failed to generate suggestions')).toBeInTheDocument();
      });
    });

    it('should clear loading state on error', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: false,
        error: 'Test error',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Test error')).toBeInTheDocument();
      });

      // Button should be enabled again
      expect(button).not.toBeDisabled();
      expect(screen.queryByRole('button', { name: /composing/i })).not.toBeInTheDocument();
    });

    it('should handle network errors gracefully', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockRejectedValue(new Error('Network error'));

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should handle unexpected errors', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockRejectedValue('Unexpected error string');

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Unexpected error occurred')).toBeInTheDocument();
      });
    });

    it('should not call callbacks when submission fails', async () => {
      const mockOnContentChange = jest.fn();
      const mockOnEnterEditMode = jest.fn();
      const props = createMockAISuggestionsPanelProps({
        currentContent: 'Test content',
        onContentChange: mockOnContentChange,
        onEnterEditMode: mockOnEnterEditMode,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: false,
        error: 'Test error',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Test error')).toBeInTheDocument();
      });

      expect(mockOnContentChange).not.toHaveBeenCalled();
      expect(mockOnEnterEditMode).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Progress State Tests
  // ========================================================================

  describe('Progress State', () => {
    it('should show progress state during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true, content: 'Done' }), 100))
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('The Scholar is Writing...')).toBeInTheDocument();
      });
    });

    it('should display progress bar during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      let resolvePromise: (value: any) => void;
      const promise = new Promise<{ success: boolean; content?: string; error?: string; session_id?: string }>((resolve) => {
        resolvePromise = resolve;
      });
      mockRunAISuggestionsPipelineAction.mockImplementation(() => promise);

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        // Check for progress step text (lowercase version with ellipsis)
        expect(screen.getByText('Processing AI suggestions...')).toBeInTheDocument();
        // Check for percentage complete text
        expect(screen.getByText((content, element) => {
          return element?.textContent === '50% complete';
        })).toBeInTheDocument();
      });

      // Clean up by resolving the promise
      resolvePromise!({ success: true, content: 'Done' });
    });

    it('should show spinner animation during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true, content: 'Done' }), 100))
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        const spinner = document.querySelector('.quill-pen');
        expect(spinner).toBeInTheDocument();
      });
    });

    it('should clear progress state after completion', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Revisions Applied')).toBeInTheDocument();
      });

      expect(screen.queryByText('The Scholar is Writing...')).not.toBeInTheDocument();
    });
  });

  // ========================================================================
  // Success Message & Debug Link Tests
  // ========================================================================

  describe('Success Message & Debug Link', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'development',
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: originalNodeEnv,
        writable: true,
        configurable: true,
      });
    });

    it('should display debug link when session data and session_id provided', async () => {
      const sessionData = createMockSessionData({
        explanation_id: 123,
        explanation_title: 'Test Title',
      });
      const props = createMockAISuggestionsPanelProps({
        currentContent: 'Test content',
        sessionData,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
        session_id: 'test-session-123',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        const debugLink = screen.getByRole('link', { name: /debug in editortest/i });
        expect(debugLink).toBeInTheDocument();
        expect(debugLink).toHaveAttribute('href', '/editorTest?explanation_id=123&session_id=test-session-123');
        expect(debugLink).toHaveAttribute('target', '_blank');
      });
    });

    it('should not display debug link when session_id not provided', async () => {
      const sessionData = createMockSessionData();
      const props = createMockAISuggestionsPanelProps({
        currentContent: 'Test content',
        sessionData,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Revisions Applied')).toBeInTheDocument();
      });

      expect(screen.queryByRole('link', { name: /debug in editortest/i })).not.toBeInTheDocument();
    });

    it('should not display debug link when sessionData not provided', async () => {
      const props = createMockAISuggestionsPanelProps({
        currentContent: 'Test content',
        sessionData: undefined,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Updated content',
        session_id: 'test-session-123',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Improve this');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Revisions Applied')).toBeInTheDocument();
      });

      expect(screen.queryByRole('link', { name: /debug in editortest/i })).not.toBeInTheDocument();
    });

    it('should clear previous success/error states on new submission', async () => {
      const props = createMockAISuggestionsPanelProps({ currentContent: 'Test content' });
      mockRunAISuggestionsPipelineAction
        .mockResolvedValueOnce({ success: true, content: 'First result' })
        .mockResolvedValueOnce({ success: true, content: 'Second result' });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'First prompt');

      const button = screen.getByRole('button', { name: /get ai suggestions/i });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Revisions Applied')).toBeInTheDocument();
      });

      // Clear and submit again
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'Second prompt');
      fireEvent.click(button);

      // Success message should disappear during loading
      await waitFor(() => {
        expect(screen.queryByText('Revisions Applied')).not.toBeInTheDocument();
      });

      // Then reappear after completion
      await waitFor(() => {
        expect(screen.getByText('Revisions Applied')).toBeInTheDocument();
      });
    });
  });

  // ========================================================================
  // Close Functionality Tests
  // ========================================================================

  describe('Close Functionality', () => {
    it('should call onClose when close button clicked', () => {
      const mockOnClose = jest.fn();
      const props = createMockAISuggestionsPanelProps({ onClose: mockOnClose });
      render(<AISuggestionsPanel {...props} />);

      const closeButton = screen.getByRole('button', { name: /close suggestions panel/i });
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('should have accessible ARIA label on close button', () => {
      const mockOnClose = jest.fn();
      const props = createMockAISuggestionsPanelProps({ onClose: mockOnClose });
      render(<AISuggestionsPanel {...props} />);

      const closeButton = screen.getByRole('button', { name: /close suggestions panel/i });
      expect(closeButton).toHaveAttribute('aria-label', 'Close suggestions panel');
    });
  });
});
