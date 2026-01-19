/**
 * Tests for ShareButton component.
 * Covers clipboard copy, fallback path, state toggle, variants, and accessibility.
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShareButton from './ShareButton';

// Mock clipboard API
const mockWriteText = jest.fn();

// Store original clipboard to restore later
const originalClipboard = navigator.clipboard;

beforeEach(() => {
  mockWriteText.mockReset();
  mockWriteText.mockResolvedValue(undefined);

  // Use defineProperty to mock the read-only clipboard property
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: mockWriteText,
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  // Restore original clipboard
  Object.defineProperty(navigator, 'clipboard', {
    value: originalClipboard,
    writable: true,
    configurable: true,
  });
});

describe('ShareButton', () => {
  describe('rendering', () => {
    it('renders with text variant by default', () => {
      render(<ShareButton url="https://example.com" />);

      expect(screen.getByRole('button')).toBeInTheDocument();
      expect(screen.getByText('Share')).toBeInTheDocument();
    });

    it('renders icon-only variant', () => {
      render(<ShareButton url="https://example.com" variant="icon" />);

      expect(screen.getByRole('button')).toBeInTheDocument();
      expect(screen.queryByText('Share')).not.toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(<ShareButton url="https://example.com" className="custom-class" />);

      expect(screen.getByRole('button')).toHaveClass('custom-class');
    });
  });

  describe('clipboard functionality', () => {
    it('shows "Copied!" feedback after click', async () => {
      const user = userEvent.setup();
      render(<ShareButton url="https://example.com/test" />);

      // Before click, should show "Share"
      expect(screen.getByText('Share')).toBeInTheDocument();

      await user.click(screen.getByRole('button'));

      // After click, should show "Copied!"
      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });
    });

    it('resets to "Share" after timeout', async () => {
      jest.useFakeTimers();
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<ShareButton url="https://example.com" />);

      await user.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });

      // Advance timers to trigger the reset
      act(() => {
        jest.advanceTimersByTime(2100);
      });

      await waitFor(() => {
        expect(screen.getByText('Share')).toBeInTheDocument();
      });

      jest.useRealTimers();
    });

    it('handles click when clipboard API is unavailable', async () => {
      // Simulate clipboard API not being available
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: jest.fn().mockRejectedValue(new Error('Unavailable')),
        },
        writable: true,
        configurable: true,
      });

      const user = userEvent.setup();
      render(<ShareButton url="https://example.com/fallback" />);

      await user.click(screen.getByRole('button'));

      // Should still show "Copied!" via fallback mechanism
      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });
    });
  });

  describe('event handling', () => {
    it('stops event propagation', async () => {
      const parentClickHandler = jest.fn();
      const user = userEvent.setup();

      render(
        <div onClick={parentClickHandler}>
          <ShareButton url="https://example.com" />
        </div>
      );

      await user.click(screen.getByRole('button'));

      // Wait for the button state to change (proves click handler ran)
      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });

      // Parent should not have received the click
      expect(parentClickHandler).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('has accessible aria-label before copy', () => {
      render(<ShareButton url="https://example.com" />);

      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Share link');
    });

    it('updates aria-label after copy', async () => {
      const user = userEvent.setup();
      render(<ShareButton url="https://example.com" />);

      await user.click(screen.getByRole('button'));

      await waitFor(() => {
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Link copied');
      });
    });

    it('is keyboard accessible', async () => {
      const user = userEvent.setup();
      render(<ShareButton url="https://example.com" />);

      const button = screen.getByRole('button');
      button.focus();

      await user.keyboard('{Enter}');

      // Verify the button action was triggered (state changed)
      await waitFor(() => {
        expect(screen.getByText('Copied!')).toBeInTheDocument();
      });
    });
  });

  describe('icon variant', () => {
    it('does not show text in icon variant', () => {
      render(<ShareButton url="https://example.com" variant="icon" />);

      expect(screen.queryByText('Share')).not.toBeInTheDocument();
      expect(screen.queryByText('Copied!')).not.toBeInTheDocument();
    });

    it('changes icon color after copy in icon variant', async () => {
      const user = userEvent.setup();
      render(<ShareButton url="https://example.com" variant="icon" />);

      await user.click(screen.getByRole('button'));

      await waitFor(() => {
        // After copy, the aria-label should change indicating the state change
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Link copied');
      });
    });
  });
});
