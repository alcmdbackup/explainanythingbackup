import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AIEditorPanel from './AIEditorPanel';
import { runAISuggestionsPipelineAction, getSessionValidationResultsAction } from '../editorFiles/actions/actions';
import {
  createMockAISuggestionsPanelProps,
  createMockSessionData,
} from '@/testing/utils/component-test-helpers';

// Mock dependencies
jest.mock('../editorFiles/actions/actions', () => ({
  runAISuggestionsPipelineAction: jest.fn(),
  getSessionValidationResultsAction: jest.fn(),
}));

describe('AIEditorPanel', () => {
  const mockRunAISuggestionsPipelineAction = runAISuggestionsPipelineAction as jest.MockedFunction<
    typeof runAISuggestionsPipelineAction
  >;
  const mockGetSessionValidationResultsAction = getSessionValidationResultsAction as jest.MockedFunction<
    typeof getSessionValidationResultsAction
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
      render(<AIEditorPanel {...props} />);

      expect(screen.getByText('Suggest edits')).toBeInTheDocument();
    });

    it('should render collapsed panel when isOpen is false', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: false });
      render(<AIEditorPanel {...props} />);

      // Panel should render but be collapsed (w-0)
      const panel = screen.getByRole('complementary');
      expect(panel).toHaveClass('w-0');
    });

    it('should render panel header with title', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AIEditorPanel {...props} />);

      expect(screen.getByText('Suggest edits')).toBeInTheDocument();
    });

    it('should show "Rewrite article" header when outputMode is rewrite', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true, outputMode: 'rewrite' });
      render(<AIEditorPanel {...props} />);

      expect(screen.getByText('Rewrite article')).toBeInTheDocument();
    });

    it('should render collapse/expand toggle button', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AIEditorPanel {...props} />);

      const toggleButton = screen.getByRole('button', { name: /collapse ai panel/i });
      expect(toggleButton).toBeInTheDocument();
    });

    it('should call onOpenChange when toggle button is clicked', () => {
      const mockOnOpenChange = jest.fn();
      const props = createMockAISuggestionsPanelProps({ isOpen: true, onOpenChange: mockOnOpenChange });
      render(<AIEditorPanel {...props} />);

      const toggleButton = screen.getByRole('button', { name: /collapse ai panel/i });
      fireEvent.click(toggleButton);

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });

    it('should render form elements correctly', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AIEditorPanel {...props} />);

      expect(screen.getByLabelText(/what would you like to improve/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/describe your desired changes/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /get suggestions/i })).toBeInTheDocument();
    });

    it('should render quick action buttons', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AIEditorPanel {...props} />);

      expect(screen.getByRole('button', { name: /simplify/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /fix grammar/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /make formal/i })).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Form Input Tests
  // ========================================================================

  describe('Form Input', () => {
    it('should update prompt on textarea change', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AIEditorPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Make it more concise');

      expect(textarea).toHaveValue('Make it more concise');
    });

    it('should display placeholder text', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AIEditorPanel {...props} />);

      const textarea = screen.getByPlaceholderText(/describe your desired changes/i);
      expect(textarea).toBeInTheDocument();
    });

    it('should disable textarea during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AIEditorPanel {...props} />);

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
      render(<AIEditorPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      expect(textarea).toHaveValue('');
    });

    it('should handle textarea resize-none class', () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AIEditorPanel {...props} />);

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
      render(<AIEditorPanel {...props} />);

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be disabled when content is empty', () => {
      const props = createMockAISuggestionsPanelProps({ isVisible: true, currentContent: '' });
      render(<AIEditorPanel {...props} />);

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      expect(submitButton).toBeDisabled();
    });

    it('should be enabled when both prompt and content exist', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      render(<AIEditorPanel {...props} />);

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

      render(<AIEditorPanel {...props} />);

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
  // API Submission Tests
  // ========================================================================

  describe('API Submission', () => {
    it('should call action with correct parameters', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'Modified content',
      });

      render(<AIEditorPanel {...props} />);

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
        isVisible: true,
        onContentChange: mockOnContentChange,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content from AI',
      });

      render(<AIEditorPanel {...props} />);

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
        isVisible: true,
        onEnterEditMode: mockOnEnterEditMode,
      });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content',
      });

      render(<AIEditorPanel {...props} />);

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

      render(<AIEditorPanel {...props} />);

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

      render(<AIEditorPanel {...props} />);

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

      render(<AIEditorPanel {...props} />);

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
      render(<AIEditorPanel {...props} />);

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
      const props = createMockAISuggestionsPanelProps({ isVisible: true, sessionData });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content',
      });

      render(<AIEditorPanel {...props} />);

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
  // Loading State Tests
  // ========================================================================

  describe('Loading State', () => {
    it('should show loading indicator during submission', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AIEditorPanel {...props} />);

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

      render(<AIEditorPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('50%')).toBeInTheDocument();
      });
    });

    it('should disable submit button during loading', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<AIEditorPanel {...props} />);

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
      render(<AIEditorPanel {...props} />);

      const collapseButton = screen.getByRole('button', { name: /collapse ai panel/i });
      fireEvent.click(collapseButton);

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });

    it('should call onOpenChange with true when expand button is clicked', async () => {
      const mockOnOpenChange = jest.fn();
      const props = createMockAISuggestionsPanelProps({
        isOpen: false,
        onOpenChange: mockOnOpenChange,
      });
      render(<AIEditorPanel {...props} />);

      const expandButton = screen.getByRole('button', { name: /expand ai panel/i });
      fireEvent.click(expandButton);

      expect(mockOnOpenChange).toHaveBeenCalledWith(true);
    });
  });

  // ========================================================================
  // Validation Results Tests
  // ========================================================================

  describe('Validation Results', () => {
    it('should display validation badges on successful response with validation results', async () => {
      const props = createMockAISuggestionsPanelProps({ isOpen: true });
      mockRunAISuggestionsPipelineAction.mockResolvedValue({
        success: true,
        content: 'New content',
        validationResults: {
          step2: { valid: true, issues: [], severity: 'warning', description: 'Step 2 validation' },
          step3: { valid: false, issues: ['Bad markup'], severity: 'error', description: 'Step 3 validation' },
        },
      });

      render(<AIEditorPanel {...props} />);

      const textarea = screen.getByRole('textbox', { name: /what would you like to improve/i });
      await userEvent.type(textarea, 'Test prompt');

      const submitButton = screen.getByRole('button', { name: /get suggestions/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('B2')).toBeInTheDocument();
        expect(screen.getByText('B3')).toBeInTheDocument();
        expect(screen.getByText('Pipeline Validation:')).toBeInTheDocument();
      });
    });

    it('should load validation results when loadedSessionId is provided', async () => {
      mockGetSessionValidationResultsAction.mockResolvedValue({
        success: true,
        data: {
          step2: { valid: true, issues: [], severity: 'warning', description: 'Step 2 passed' },
          step3: { valid: true, issues: [], severity: 'warning', description: 'Step 3 passed' },
        },
        error: null,
      });

      const props = createMockAISuggestionsPanelProps({
        isVisible: true,
        loadedSessionId: 'test-session-123',
      });
      render(<AIEditorPanel {...props} />);

      await waitFor(() => {
        expect(mockGetSessionValidationResultsAction).toHaveBeenCalledWith('test-session-123');
      });

      await waitFor(() => {
        expect(screen.getByTestId('loaded-validation-results')).toBeInTheDocument();
        expect(screen.getByText('Previous Session Validation:')).toBeInTheDocument();
      });
    });
  });
});
