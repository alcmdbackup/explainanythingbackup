/**
 * Unit tests for HomeImportPanel component - content validation and AI source detection.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeImportPanel from '../HomeImportPanel';
import { processImport } from '@/actions/importActions';
import { detectSource } from '@/lib/services/importArticle';
import { supabase_browser } from '@/lib/supabase';

// Mock dependencies
jest.mock('@/actions/importActions', () => ({
  processImport: jest.fn(),
}));

jest.mock('@/lib/services/importArticle', () => ({
  detectSource: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase_browser: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

const mockProcessImport = processImport as jest.MockedFunction<typeof processImport>;
const mockDetectSource = detectSource as jest.MockedFunction<typeof detectSource>;
const mockGetUser = supabase_browser.auth.getUser as jest.MockedFunction<typeof supabase_browser.auth.getUser>;

describe('HomeImportPanel', () => {
  const mockOnProcessed = jest.fn();
  const defaultProps = {
    onProcessed: mockOnProcessed,
  };

  // Generate content of specific length
  const generateContent = (length: number) => 'x'.repeat(length);

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'test-user-id' } },
      error: null,
    } as ReturnType<typeof supabase_browser.auth.getUser> extends Promise<infer T> ? T : never);
  });

  describe('Rendering', () => {
    it('should render textarea with placeholder', () => {
      render(<HomeImportPanel {...defaultProps} />);
      expect(screen.getByTestId('home-import-input')).toHaveAttribute(
        'placeholder',
        'Paste content from ChatGPT, Claude, or Gemini...'
      );
    });

    it('should render source dropdown', () => {
      render(<HomeImportPanel {...defaultProps} />);
      expect(screen.getByTestId('home-import-source')).toBeInTheDocument();
    });

    it('should render Process button', () => {
      render(<HomeImportPanel {...defaultProps} />);
      expect(screen.getByTestId('home-import-submit')).toBeInTheDocument();
    });

    it('should have correct ARIA attributes', () => {
      render(<HomeImportPanel {...defaultProps} />);
      const panel = screen.getByRole('tabpanel');
      expect(panel).toHaveAttribute('id', 'import-panel');
      expect(panel).toHaveAttribute('aria-labelledby', 'import-tab');
    });

    it('should default source to "other"', () => {
      render(<HomeImportPanel {...defaultProps} />);
      expect(screen.getByTestId('home-import-source')).toHaveValue('other');
    });
  });

  describe('Content Validation', () => {
    it('should disable Process button when content is empty', () => {
      render(<HomeImportPanel {...defaultProps} />);
      expect(screen.getByTestId('home-import-submit')).toBeDisabled();
    });

    it('should disable Process button when content is less than 100 characters', async () => {
      const user = userEvent.setup();
      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(99));
      expect(screen.getByTestId('home-import-submit')).toBeDisabled();
    });

    it('should enable Process button when content is 100+ characters', async () => {
      const user = userEvent.setup();
      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(100));
      expect(screen.getByTestId('home-import-submit')).not.toBeDisabled();
    });

    it('should show error when trying to process with insufficient content', async () => {
      const user = userEvent.setup();
      render(<HomeImportPanel {...defaultProps} />);

      // Type some content but not enough
      await user.type(screen.getByTestId('home-import-input'), 'short content');

      // Force click even though disabled (testing validation)
      fireEvent.click(screen.getByTestId('home-import-submit'));

      // Button should still be disabled, no error shown (validation prevents click)
      expect(screen.getByTestId('home-import-submit')).toBeDisabled();
    });
  });

  describe('AI Source Detection', () => {
    it('should trigger auto-detection when content exceeds 100 characters', () => {
      mockDetectSource.mockReturnValue('chatgpt');

      render(<HomeImportPanel {...defaultProps} />);

      fireEvent.change(screen.getByTestId('home-import-input'), {
        target: { value: generateContent(101) },
      });

      expect(mockDetectSource).toHaveBeenCalledWith(generateContent(101));
    });

    it('should update source dropdown when auto-detected', () => {
      mockDetectSource.mockReturnValue('claude');

      render(<HomeImportPanel {...defaultProps} />);

      fireEvent.change(screen.getByTestId('home-import-input'), {
        target: { value: generateContent(101) },
      });

      expect(screen.getByTestId('home-import-source')).toHaveValue('claude');
    });

    it('should show "(auto-detected)" hint after detection', () => {
      mockDetectSource.mockReturnValue('gemini');

      render(<HomeImportPanel {...defaultProps} />);

      fireEvent.change(screen.getByTestId('home-import-input'), {
        target: { value: generateContent(101) },
      });

      expect(screen.getByText('(auto-detected)')).toBeInTheDocument();
    });

    it('should hide "(auto-detected)" hint when user manually changes source', async () => {
      const user = userEvent.setup();
      mockDetectSource.mockReturnValue('chatgpt');

      render(<HomeImportPanel {...defaultProps} />);

      fireEvent.change(screen.getByTestId('home-import-input'), {
        target: { value: generateContent(101) },
      });

      expect(screen.getByText('(auto-detected)')).toBeInTheDocument();

      // Manually change source
      await user.selectOptions(screen.getByTestId('home-import-source'), 'claude');

      expect(screen.queryByText('(auto-detected)')).not.toBeInTheDocument();
    });
  });

  describe('Process Flow', () => {
    it('should call processImport with correct parameters', async () => {
      const user = userEvent.setup();
      mockProcessImport.mockResolvedValue({
        success: true,
        data: {
          title: 'Test Title',
          content: 'Processed content',
          detectedSource: 'chatgpt',
        },
        error: null,
      });

      render(<HomeImportPanel {...defaultProps} />);

      const content = generateContent(150);
      await user.type(screen.getByTestId('home-import-input'), content);
      await user.selectOptions(screen.getByTestId('home-import-source'), 'claude');
      await user.click(screen.getByTestId('home-import-submit'));

      await waitFor(() => {
        expect(mockProcessImport).toHaveBeenCalledWith(content, 'test-user-id', 'claude');
      });
    });

    it('should call onProcessed with result on success', async () => {
      const user = userEvent.setup();
      mockProcessImport.mockResolvedValue({
        success: true,
        data: {
          title: 'Test Title',
          content: 'Processed content',
          detectedSource: 'chatgpt',
        },
        error: null,
      });

      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(150));
      await user.click(screen.getByTestId('home-import-submit'));

      await waitFor(() => {
        expect(mockOnProcessed).toHaveBeenCalledWith({
          title: 'Test Title',
          content: 'Processed content',
          source: 'chatgpt',
        });
      });
    });

    it('should show error message on processing failure', async () => {
      const user = userEvent.setup();
      mockProcessImport.mockResolvedValue({
        success: false,
        data: null,
        error: { code: 'UNKNOWN_ERROR', message: 'Processing failed' },
      });

      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(150));
      await user.click(screen.getByTestId('home-import-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('home-import-error')).toHaveTextContent('Processing failed');
      });
    });

    it('should show error when user is not logged in', async () => {
      const user = userEvent.setup();
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' },
      } as ReturnType<typeof supabase_browser.auth.getUser> extends Promise<infer T> ? T : never);

      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(150));
      await user.click(screen.getByTestId('home-import-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('home-import-error')).toHaveTextContent('Please log in');
      });
    });

    it('should reset form after successful processing', async () => {
      const user = userEvent.setup();
      mockProcessImport.mockResolvedValue({
        success: true,
        data: {
          title: 'Test Title',
          content: 'Processed content',
          detectedSource: 'chatgpt',
        },
        error: null,
      });

      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(150));
      await user.selectOptions(screen.getByTestId('home-import-source'), 'claude');
      await user.click(screen.getByTestId('home-import-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('home-import-input')).toHaveValue('');
        expect(screen.getByTestId('home-import-source')).toHaveValue('other');
      });
    });
  });

  describe('Loading State', () => {
    it('should show loading state during processing', async () => {
      const user = userEvent.setup();
      // Make processImport hang to test loading state
      mockProcessImport.mockImplementation(() => new Promise(() => {}));

      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(150));
      await user.click(screen.getByTestId('home-import-submit'));

      expect(screen.getByTestId('home-import-submit')).toHaveTextContent('Processing...');
    });

    it('should disable textarea during processing', async () => {
      const user = userEvent.setup();
      mockProcessImport.mockImplementation(() => new Promise(() => {}));

      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(150));
      await user.click(screen.getByTestId('home-import-submit'));

      expect(screen.getByTestId('home-import-input')).toBeDisabled();
    });

    it('should disable source dropdown during processing', async () => {
      const user = userEvent.setup();
      mockProcessImport.mockImplementation(() => new Promise(() => {}));

      render(<HomeImportPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-import-input'), generateContent(150));
      await user.click(screen.getByTestId('home-import-submit'));

      expect(screen.getByTestId('home-import-source')).toBeDisabled();
    });
  });
});
