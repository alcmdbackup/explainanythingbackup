/**
 * Baseline unit tests for SourceInput component — input rendering,
 * submit behavior, disabled/limit states, and error display.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SourceInput from '../SourceInput';

// Mock the useSourceSubmit hook
const mockSubmitUrl = jest.fn();
const mockClearError = jest.fn();
let mockHookState = {
  isSubmitting: false,
  error: null as string | null,
};

jest.mock('@/hooks/useSourceSubmit', () => {
  return jest.fn(() => ({
    submitUrl: mockSubmitUrl,
    isSubmitting: mockHookState.isSubmitting,
    error: mockHookState.error,
    clearError: mockClearError,
  }));
});

describe('SourceInput', () => {
  const defaultProps = {
    onSourceAdded: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHookState = { isSubmitting: false, error: null };
  });

  // ============================================================================
  // Rendering
  // ============================================================================
  describe('rendering', () => {
    it('renders input and add button', () => {
      render(<SourceInput {...defaultProps} />);
      expect(screen.getByTestId('source-url-input')).toBeInTheDocument();
      expect(screen.getByTestId('source-add-button')).toBeInTheDocument();
    });

    it('shows placeholder text', () => {
      render(<SourceInput {...defaultProps} />);
      expect(screen.getByPlaceholderText('Paste source URL...')).toBeInTheDocument();
    });

    it('renders at-limit message when currentCount >= maxSources', () => {
      render(<SourceInput {...defaultProps} maxSources={3} currentCount={3} />);
      expect(screen.getByText('Maximum 3 sources reached')).toBeInTheDocument();
      expect(screen.queryByTestId('source-url-input')).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Submit behavior
  // ============================================================================
  describe('submit', () => {
    it('calls submitUrl on button click', async () => {
      render(<SourceInput {...defaultProps} />);

      const input = screen.getByTestId('source-url-input');
      fireEvent.change(input, { target: { value: 'https://example.com' } });
      fireEvent.click(screen.getByTestId('source-add-button'));

      expect(mockSubmitUrl).toHaveBeenCalledWith('https://example.com');
    });

    it('calls submitUrl on Enter key', async () => {
      render(<SourceInput {...defaultProps} />);

      const input = screen.getByTestId('source-url-input');
      fireEvent.change(input, { target: { value: 'https://example.com' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockSubmitUrl).toHaveBeenCalledWith('https://example.com');
    });

    it('does not submit when input is empty', () => {
      render(<SourceInput {...defaultProps} />);

      fireEvent.click(screen.getByTestId('source-add-button'));
      expect(mockSubmitUrl).not.toHaveBeenCalled();
    });

    it('does not submit when disabled', () => {
      render(<SourceInput {...defaultProps} disabled />);

      const input = screen.getByTestId('source-url-input');
      fireEvent.change(input, { target: { value: 'https://example.com' } });
      fireEvent.click(screen.getByTestId('source-add-button'));

      expect(mockSubmitUrl).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Disabled states
  // ============================================================================
  describe('disabled states', () => {
    it('disables input when disabled prop is true', () => {
      render(<SourceInput {...defaultProps} disabled />);
      expect(screen.getByTestId('source-url-input')).toBeDisabled();
    });

    it('disables add button when no text entered', () => {
      render(<SourceInput {...defaultProps} />);
      expect(screen.getByTestId('source-add-button')).toBeDisabled();
    });

    it('enables add button when text is entered', () => {
      render(<SourceInput {...defaultProps} />);

      fireEvent.change(screen.getByTestId('source-url-input'), {
        target: { value: 'https://example.com' },
      });

      expect(screen.getByTestId('source-add-button')).not.toBeDisabled();
    });
  });

  // ============================================================================
  // Error display
  // ============================================================================
  describe('error display', () => {
    it('shows error message when hook has error', () => {
      mockHookState.error = 'Invalid URL';
      render(<SourceInput {...defaultProps} />);
      expect(screen.getByText('Invalid URL')).toBeInTheDocument();
    });

    it('clears error on input change', () => {
      mockHookState.error = 'Invalid URL';
      render(<SourceInput {...defaultProps} />);

      fireEvent.change(screen.getByTestId('source-url-input'), {
        target: { value: 'a' },
      });

      expect(mockClearError).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Custom className
  // ============================================================================
  describe('className prop', () => {
    it('applies custom className', () => {
      const { container } = render(
        <SourceInput {...defaultProps} className="custom-test-class" />
      );
      expect(container.firstChild).toHaveClass('custom-test-class');
    });
  });
});
