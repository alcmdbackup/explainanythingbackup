import { render, screen, fireEvent } from '@testing-library/react';
import OutputModeToggle, { type OutputMode } from './OutputModeToggle';

describe('OutputModeToggle', () => {
  const mockOnChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Default state', () => {
    it('should render with inline-diff selected by default when value is inline-diff', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} />);

      const inlineDiffButton = screen.getByTestId('output-mode-inline-diff');
      const rewriteButton = screen.getByTestId('output-mode-rewrite');

      expect(inlineDiffButton).toHaveAttribute('aria-checked', 'true');
      expect(rewriteButton).toHaveAttribute('aria-checked', 'false');
    });

    it('should render with rewrite selected when value is rewrite', () => {
      render(<OutputModeToggle value="rewrite" onChange={mockOnChange} />);

      const inlineDiffButton = screen.getByTestId('output-mode-inline-diff');
      const rewriteButton = screen.getByTestId('output-mode-rewrite');

      expect(inlineDiffButton).toHaveAttribute('aria-checked', 'false');
      expect(rewriteButton).toHaveAttribute('aria-checked', 'true');
    });

    it('should render the toggle container with correct testid', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} />);

      expect(screen.getByTestId('output-mode-toggle')).toBeInTheDocument();
    });
  });

  describe('onChange behavior', () => {
    it('should call onChange with rewrite when rewrite button is clicked', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} />);

      const rewriteButton = screen.getByTestId('output-mode-rewrite');
      fireEvent.click(rewriteButton);

      expect(mockOnChange).toHaveBeenCalledWith('rewrite');
    });

    it('should call onChange with inline-diff when inline-diff button is clicked', () => {
      render(<OutputModeToggle value="rewrite" onChange={mockOnChange} />);

      const inlineDiffButton = screen.getByTestId('output-mode-inline-diff');
      fireEvent.click(inlineDiffButton);

      expect(mockOnChange).toHaveBeenCalledWith('inline-diff');
    });

    it('should call onChange even when clicking currently selected mode', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} />);

      const inlineDiffButton = screen.getByTestId('output-mode-inline-diff');
      fireEvent.click(inlineDiffButton);

      expect(mockOnChange).toHaveBeenCalledWith('inline-diff');
    });
  });

  describe('Disabled state', () => {
    it('should disable both buttons when disabled prop is true', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} disabled />);

      const inlineDiffButton = screen.getByTestId('output-mode-inline-diff');
      const rewriteButton = screen.getByTestId('output-mode-rewrite');

      expect(inlineDiffButton).toBeDisabled();
      expect(rewriteButton).toBeDisabled();
    });

    it('should not call onChange when clicking disabled buttons', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} disabled />);

      const rewriteButton = screen.getByTestId('output-mode-rewrite');
      fireEvent.click(rewriteButton);

      expect(mockOnChange).not.toHaveBeenCalled();
    });
  });

  describe('Tooltip descriptions', () => {
    it('should have inline-diff description in title attribute', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} />);

      const inlineDiffButton = screen.getByTestId('output-mode-inline-diff');
      expect(inlineDiffButton).toHaveAttribute('title', expect.stringMatching(/tracked changes you can accept/i));
    });

    it('should have rewrite description in title attribute', () => {
      render(<OutputModeToggle value="rewrite" onChange={mockOnChange} />);

      const rewriteButton = screen.getByTestId('output-mode-rewrite');
      expect(rewriteButton).toHaveAttribute('title', expect.stringMatching(/generates a completely new version/i));
    });
  });

  describe('Accessibility', () => {
    it('should have proper role radiogroup on container', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} />);

      const container = screen.getByRole('radiogroup');
      expect(container).toBeInTheDocument();
    });

    it('should have proper role radio on buttons', () => {
      render(<OutputModeToggle value="inline-diff" onChange={mockOnChange} />);

      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(2);
    });
  });
});
