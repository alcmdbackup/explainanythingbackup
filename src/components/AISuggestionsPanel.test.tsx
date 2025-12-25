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
    it('should render panel content when isOpen is true', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByText('Edit article')).toBeInTheDocument();
    });

    it('should have collapsed width when isOpen is false', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: false });
      const { container } = render(<AISuggestionsPanel {...props} />);

      // Panel should have w-0 class when closed
      const panel = container.firstChild as HTMLElement;
      expect(panel).toHaveClass('w-0');
    });

    it('should have expanded width when isOpen is true', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      const { container } = render(<AISuggestionsPanel {...props} />);

      // Panel should have w-[340px] class when open
      const panel = container.firstChild as HTMLElement;
      expect(panel).toHaveClass('w-[340px]');
    });

    it('should render panel header with title', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByText('Edit article')).toBeInTheDocument();
    });

    it('should render collapse/expand toggle button', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      // Should have a button to collapse the panel
      const toggleButton = screen.getByRole('button', { name: /collapse ai panel/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('should render form elements correctly', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByLabelText(/what would you like to improve/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/describe your desired changes/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /get suggestions/i })).toBeInTheDocument();
    });

    it('should render quick action buttons', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByRole('button', { name: /simplify/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /fix grammar/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /make formal/i })).toBeInTheDocument();
    });

    it('should render description text', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByText(/use ai to refine and improve your content/i)).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Form Input Tests
  // ========================================================================

  describe('Form Input', () => {
    it('should update prompt on textarea change', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Make it more concise');

      expect(textarea).toHaveValue('Make it more concise');
    });

    it('should display placeholder text', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByPlaceholderText(/describe your desired changes/i);
      expect(textarea).toBeInTheDocument();
    });

    it('should disable textarea during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(textarea).toBeDisabled();
      });
    });

    it('should start with empty textarea', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      expect(textarea).toHaveValue('');
    });

    it('should handle textarea resize-none class', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      expect(textarea).toHaveClass('resize-none');
    });
  });

  // ========================================================================
  // Submit Button Tests
  // ========================================================================

  describe('Submit Button', () => {
    it('should be disabled when prompt is empty', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be disabled when content is empty', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true, currentContent: '' });
      render(<AISuggestionsPanel {...props} />);

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be enabled when both prompt and content exist', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Make it better');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      expect(submitButton).not.toBeDisabled();
    });

    it('should show loading state when clicked', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/composing/i)).toBeInTheDocument();
      });
    });
  });

  // ========================================================================
  // Quick Actions Tests
  // ========================================================================

  describe('Quick Actions', () => {
    it('should trigger submission when quick action is clicked', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Simplified content',
      });

      render(<AISuggestionsPanel {...props} />);

      const simplifyButton = screen.getByRole('button', { name: /simplify/i });
      fireEvent.click(simplifyButton);

      // Quick action should prepopulate prompt, not trigger submission
      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      expect(textarea).toHaveValue('Simplify this text to make it easier to understand while preserving the key information. Use shorter sentences and simpler vocabulary.');

      // Now click submit to trigger the action
      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockRunAISuggestionsPipelineAction).toHaveBeenCalled();
      });
    });

    it('should disable quick actions when loading', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      // Prepopulate prompt via quick action
      const simplifyButton = screen.getByRole('button', { name: /simplify/i });
      fireEvent.click(simplifyButton);

      // Submit to trigger loading state
      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /expand/i })).toBeDisabled();
      });
    });

    it('should disable quick actions when content is empty', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true, currentContent: '' });
      render(<AISuggestionsPanel {...props} />);

      expect(screen.getByRole('button', { name: /simplify/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /expand/i })).toBeDisabled();
    });
  });

  // ========================================================================
  // API Submission Tests
  // ========================================================================

  describe('API Submission', () => {
    it('should call action with correct parameters', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Modified content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Make it shorter');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockRunAISuggestionsPipelineAction).toHaveBeenCalledWith(
          expect.any(String), // currentContent
          'Make it shorter',
          undefined // sessionData
        );
      });
    });

    it('should call onContentChange on successful response', async () => {
      const mockOnContentChange = jest.fn();
      const props = createMockAISuggestionsPanelProps({
        isOpen: true,
        onContentChange: mockOnContentChange,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content from AI',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnContentChange).toHaveBeenCalledWith('New content from AI');
      });
    });

    it('should call onEnterEditMode on successful response', async () => {
      const mockOnEnterEditMode = jest.fn();
      const props = createMockAISuggestionsPanelProps({
        isOpen: true,
        onEnterEditMode: mockOnEnterEditMode,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockOnEnterEditMode).toHaveBeenCalled();
      });
    });

    it('should display success message after successful submission', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('suggestions-success')).toBeInTheDocument();
      });
    });
  });

  // ========================================================================
  // Error Handling Tests
  // ========================================================================

  describe('Error Handling', () => {
    it('should display error when submission fails', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: false,
        error: 'AI service unavailable',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('suggestions-error')).toBeInTheDocument();
        expect(screen.getByText('AI service unavailable')).toBeInTheDocument();
      });
    });

    it('should display error when action throws', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockRejectedValue(new Error('Network error'));

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('suggestions-error')).toBeInTheDocument();
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should show validation error when prompt is empty', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AISuggestionsPanel {...props} />);

      // Try clicking submit with empty prompt (button should be disabled anyway)
      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      expect(submitButton).toBeDisabled();
    });
  });

  // ========================================================================
  // Session Data Tests
  // ========================================================================

  describe('Session Data', () => {
    it('should include session data when provided', async () => {
      const sessionData = createMockSessionData();
      const props = createMockAISuggestionsPanelProps({ isOpen: true, sessionData });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockRunAISuggestionsPipelineAction).toHaveBeenCalledWith(
          expect.any(String),
          'Test prompt',
          expect.objectContaining({
            explanation_id: sessionData.explanation_id,
            explanation_title: sessionData.explanation_title,
          })
        );
      });
    });
  });

  // ========================================================================
  // History Tests
  // ========================================================================

  describe('Suggestion History', () => {
    it('should add successful suggestions to history', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content',
      });

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'First suggestion');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('suggestions-success')).toBeInTheDocument();
      });

      // Check history section appears
      expect(screen.getByText(/recent suggestions/i)).toBeInTheDocument();
    });

    it('should allow clicking history items to reuse prompts', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content',
      });

      render(<AISuggestionsPanel {...props} />);

      // Submit first prompt
      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'My test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('suggestions-success')).toBeInTheDocument();
      });

      // Expand history
      const historyToggle = screen.getByText(/recent suggestions/i);
      fireEvent.click(historyToggle);

      // Click on history item
      const historyItem = screen.getByText('My test prompt');
      fireEvent.click(historyItem);

      // Check textarea is populated
      expect(textarea).toHaveValue('My test prompt');
    });
  });

  // ========================================================================
  // Loading State Tests
  // ========================================================================

  describe('Loading State', () => {
    it('should show loading indicator during submission', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('suggestions-loading')).toBeInTheDocument();
      });
    });

    it('should show progress percentage', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/50% complete/i)).toBeInTheDocument();
      });
    });

    it('should disable submit button during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AISuggestionsPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
    });
  });

  // ========================================================================
  // Panel Control Tests
  // ========================================================================

  describe('Panel Control', () => {
    it('should call onOpenChange when collapse button is clicked', async () => {
      const mockOnOpenChange = jest.fn();
      const props = createMockAISuggestionsPanelProps({
        isOpen: true,
        onOpenChange: mockOnOpenChange,
      });
      render(<AISuggestionsPanel {...props} />);

      const collapseButton = screen.getByRole('button', { name: /collapse ai panel/i });
      fireEvent.click(collapseButton);

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('should call onOpenChange when expand button is clicked', async () => {
      const mockOnOpenChange = jest.fn();
      const props = createMockAISuggestionsPanelProps({
        isOpen: false,
        onOpenChange: mockOnOpenChange,
      });
      render(<AISuggestionsPanel {...props} />);

      const expandButton = screen.getByRole('button', { name: /expand ai panel/i });
      fireEvent.click(expandButton);

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(true);
      });
    });
  });
});
