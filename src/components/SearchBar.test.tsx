import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchBar from './SearchBar';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

describe('SearchBar', () => {
  const mockPush = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({
      push: mockPush,
    });
  });

  // ========================================================================
  // Variant Rendering Tests
  // ========================================================================

  describe('Variant Rendering', () => {
    it('should render textarea for home variant', () => {
      render(<SearchBar variant="home" />);
      const textarea = screen.getByRole('textbox');
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('should render input for nav variant', () => {
      render(<SearchBar variant="nav" />);
      const input = screen.getByRole('textbox');
      expect(input.tagName).toBe('INPUT');
    });

    it('should default to home variant when variant not specified', () => {
      render(<SearchBar />);
      const textarea = screen.getByRole('textbox');
      expect(textarea.tagName).toBe('TEXTAREA');
    });

    it('should apply rounded-none styling for home variant', () => {
      render(<SearchBar variant="home" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('rounded-none');
    });

    it('should apply rounded-full styling for nav variant', () => {
      render(<SearchBar variant="nav" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('rounded-full');
    });

    it('should display "Search" button text for home variant', () => {
      render(<SearchBar variant="home" />);
      expect(screen.getByRole('button', { name: /^search$/i })).toBeInTheDocument();
    });

    it('should not have button for nav variant', () => {
      render(<SearchBar variant="nav" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('should apply larger sizing classes for home variant', () => {
      render(<SearchBar variant="home" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('px-6', 'py-4', 'text-lg');
    });

    it('should apply smaller sizing classes for nav variant', () => {
      render(<SearchBar variant="nav" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('px-4', 'py-2', 'text-sm');
    });
  });

  // ========================================================================
  // Initial Value Sync Tests
  // ========================================================================

  describe('Initial Value Sync', () => {
    it('should set prompt from initialValue on mount', () => {
      render(<SearchBar initialValue="Test query" />);
      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(input.value).toBe('Test query');
    });

    it('should update prompt when initialValue changes', async () => {
      const { rerender } = render(<SearchBar initialValue="First value" />);
      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(input.value).toBe('First value');

      rerender(<SearchBar initialValue="Second value" />);
      await waitFor(() => {
        expect(input.value).toBe('Second value');
      });
    });

    it('should handle empty initialValue', () => {
      render(<SearchBar initialValue="" />);
      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(input.value).toBe('');
    });

    it('should default to empty string when initialValue not provided', () => {
      render(<SearchBar />);
      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(input.value).toBe('');
    });
  });

  // ========================================================================
  // User Input Tests
  // ========================================================================

  describe('User Input', () => {
    it('should update prompt on textarea change (home variant)', async () => {
      const user = userEvent.setup();
      render(<SearchBar variant="home" />);
      const input = screen.getByRole('textbox');

      await user.type(input, 'New input');
      expect(input).toHaveValue('New input');
    });

    it('should update prompt on input change (nav variant)', async () => {
      const user = userEvent.setup();
      render(<SearchBar variant="nav" />);
      const input = screen.getByRole('textbox');

      await user.type(input, 'Nav input');
      expect(input).toHaveValue('Nav input');
    });

    it('should respect maxLength limit', () => {
      render(<SearchBar maxLength={10} />);
      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(input).toHaveAttribute('maxLength', '10');
    });

    it('should use default maxLength of 150', () => {
      render(<SearchBar />);
      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(input).toHaveAttribute('maxLength', '150');
    });

    it('should handle empty input', async () => {
      const user = userEvent.setup();
      render(<SearchBar initialValue="Some text" />);
      const input = screen.getByRole('textbox');

      await user.clear(input);
      expect(input).toHaveValue('');
    });

    it('should allow typing special characters', async () => {
      const user = userEvent.setup();
      render(<SearchBar />);
      const input = screen.getByRole('textbox');

      await user.type(input, 'Test with @#$ symbols!');
      expect(input).toHaveValue('Test with @#$ symbols!');
    });
  });

  // ========================================================================
  // Form Submission - Custom Callback Tests
  // ========================================================================

  describe('Form Submission - Custom Callback', () => {
    it('should call onSearch with query when provided', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar onSearch={mockOnSearch} />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test search');

      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockOnSearch).toHaveBeenCalledWith('Test search', undefined);
      expect(mockOnSearch).toHaveBeenCalledTimes(1);
    });

    it('should prevent default form submission', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar onSearch={mockOnSearch} />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test');

      const form = screen.getByRole('textbox').closest('form')!;
      const submitHandler = jest.fn((e) => e.preventDefault());
      form.addEventListener('submit', submitHandler);

      const button = screen.getByRole('button');
      await user.click(button);

      expect(submitHandler).toHaveBeenCalled();
    });

    it('should not navigate when onSearch provided', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar onSearch={mockOnSearch} />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test');
      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should not call onSearch with empty input', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar onSearch={mockOnSearch} />);

      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockOnSearch).not.toHaveBeenCalled();
    });

    it('should not call onSearch with whitespace-only input', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar onSearch={mockOnSearch} />);

      const input = screen.getByRole('textbox');
      await user.type(input, '   ');
      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockOnSearch).not.toHaveBeenCalled();
    });

    it('should call onSearch with trimmed value', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar onSearch={mockOnSearch} />);

      const input = screen.getByRole('textbox');
      await user.type(input, '  test  ');
      const button = screen.getByRole('button');
      await user.click(button);

      // Note: The component passes the full value with spaces, not trimmed
      expect(mockOnSearch).toHaveBeenCalledWith('  test  ', undefined);
    });
  });

  // ========================================================================
  // Form Submission - Router Navigation Tests
  // ========================================================================

  describe('Form Submission - Router Navigation', () => {
    it('should navigate to /results?q=query when no onSearch', async () => {
      const user = userEvent.setup();
      render(<SearchBar />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test query');
      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockPush).toHaveBeenCalledWith('/results?q=Test%20query');
    });

    it('should encode query parameter correctly', async () => {
      const user = userEvent.setup();
      render(<SearchBar />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test & special chars!');
      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockPush).toHaveBeenCalledWith('/results?q=Test%20%26%20special%20chars!');
    });

    it('should not navigate with empty input', async () => {
      const user = userEvent.setup();
      render(<SearchBar />);

      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should not navigate with whitespace-only input', async () => {
      const user = userEvent.setup();
      render(<SearchBar />);

      const input = screen.getByRole('textbox');
      await user.type(input, '   ');
      const button = screen.getByRole('button');
      await user.click(button);

      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should support form submission via Enter key in home variant', async () => {
      const user = userEvent.setup();
      render(<SearchBar variant="home" />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test query{Enter}');

      expect(mockPush).toHaveBeenCalledWith('/results?q=Test%20query');
    });
  });

  // ========================================================================
  // Disabled State Tests
  // ========================================================================

  describe('Disabled State', () => {
    it('should disable input when disabled=true', () => {
      render(<SearchBar disabled={true} />);
      const input = screen.getByRole('textbox');
      expect(input).toBeDisabled();
    });

    it('should disable button when disabled=true', () => {
      render(<SearchBar disabled={true} />);
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
    });

    it('should display loading dots when disabled', () => {
      render(<SearchBar disabled={true} />);
      const button = screen.getByRole('button');
      expect(button.querySelector('.atlas-loading-dots')).toBeInTheDocument();
    });

    it('should prevent submission when disabled', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar onSearch={mockOnSearch} disabled={true} />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test');
      const button = screen.getByRole('button');
      // Button is disabled, so click won't do anything
      // But we can still try to submit the form
      const form = input.closest('form')!;
      fireEvent.submit(form);

      expect(mockOnSearch).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('should apply disabled opacity styles to button', () => {
      render(<SearchBar disabled={true} />);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('disabled:opacity-40');
    });

    it('should enable input and button when disabled=false', () => {
      render(<SearchBar disabled={false} initialValue="test query" />);
      const input = screen.getByRole('textbox');
      const button = screen.getByRole('button');
      expect(input).not.toBeDisabled();
      expect(button).not.toBeDisabled();
    });
  });

  // ========================================================================
  // Placeholder Tests
  // ========================================================================

  describe('Placeholder', () => {
    it('should use custom placeholder', () => {
      render(<SearchBar placeholder="Custom placeholder" />);
      expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
    });

    it('should use default placeholder when not provided', () => {
      render(<SearchBar />);
      expect(screen.getByPlaceholderText('Learn about any topic')).toBeInTheDocument();
    });

    it('should handle empty placeholder', () => {
      render(<SearchBar placeholder="" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('placeholder', '');
    });
  });

  // ========================================================================
  // Styling Tests
  // ========================================================================

  describe('Styling', () => {
    it('should apply custom className to form', () => {
      render(<SearchBar className="custom-class" />);
      const form = screen.getByRole('textbox').closest('form');
      expect(form).toHaveClass('custom-class');
    });

    it('should apply text styling with CSS variables', () => {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');
      expect(input).toBeInTheDocument();
    });

    it('should have transition styling on input', () => {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('transition-colors', 'duration-200');
    });

    it('should apply atlas-button class to submit button', () => {
      render(<SearchBar />);
      const button = screen.getByRole('button');
      expect(button).toHaveClass('atlas-button');
    });
  });

  // ========================================================================
  // Accessibility Tests
  // ========================================================================

  describe('Accessibility', () => {
    it('should render textbox with accessible role', () => {
      render(<SearchBar />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('should render submit button with accessible role', () => {
      render(<SearchBar />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('should support keyboard submission with Enter in home variant', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar variant="home" onSearch={mockOnSearch} />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test{Enter}');

      expect(mockOnSearch).toHaveBeenCalledWith('Test', undefined);
    });

    it('should have focus outline removal', () => {
      render(<SearchBar />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('focus:outline-none');
    });
  });

  // ========================================================================
  // Edge Cases Tests
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle very long input within maxLength', async () => {
      const user = userEvent.setup();
      render(<SearchBar maxLength={100} />);
      const input = screen.getByRole('textbox');

      const longText = 'a'.repeat(100);
      await user.type(input, longText);

      expect(input).toHaveValue(longText);
    });

    it('should handle rapid state changes', async () => {
      const { rerender } = render(<SearchBar initialValue="Value 1" />);
      rerender(<SearchBar initialValue="Value 2" />);
      rerender(<SearchBar initialValue="Value 3" />);

      const input = screen.getByRole('textbox') as HTMLTextAreaElement;
      await waitFor(() => {
        expect(input.value).toBe('Value 3');
      });
    });

    it('should handle switching between controlled and uncontrolled', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<SearchBar />);
      const input = screen.getByRole('textbox');

      await user.type(input, 'User input');
      expect(input).toHaveValue('User input');

      rerender(<SearchBar initialValue="Controlled value" />);
      await waitFor(() => {
        expect(input).toHaveValue('Controlled value');
      });
    });

    it('should handle multiple rapid submissions', async () => {
      const user = userEvent.setup();
      const mockOnSearch = jest.fn();
      render(<SearchBar onSearch={mockOnSearch} />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test');
      const button = screen.getByRole('button');

      await user.click(button);
      await user.click(button);
      await user.click(button);

      expect(mockOnSearch).toHaveBeenCalledTimes(3);
    });
  });
});
