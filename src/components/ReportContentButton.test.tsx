/**
 * Tests for ReportContentButton component.
 * Covers modal opening/closing, form validation, submission, and success/error states.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReportContentButton } from './ReportContentButton';

// Mock the server action
const mockCreateContentReportAction = jest.fn();
jest.mock('@/lib/services/contentReports', () => ({
  createContentReportAction: (...args: unknown[]) => mockCreateContentReportAction(...args),
}));

describe('ReportContentButton', () => {
  beforeEach(() => {
    mockCreateContentReportAction.mockReset();
  });

  describe('rendering', () => {
    it('renders the flag button', () => {
      render(<ReportContentButton explanationId={123} />);

      const button = screen.getByRole('button', { name: /report this content/i });
      expect(button).toBeInTheDocument();
    });

    it('renders disabled when disabled prop is true', () => {
      render(<ReportContentButton explanationId={123} disabled />);

      const button = screen.getByRole('button', { name: /report this content/i });
      expect(button).toBeDisabled();
    });

    it('does not render modal initially', () => {
      render(<ReportContentButton explanationId={123} />);

      expect(screen.queryByText('Report Content')).not.toBeInTheDocument();
    });
  });

  describe('modal interaction', () => {
    it('opens modal when button is clicked', async () => {
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      expect(screen.getByText('Report Content')).toBeInTheDocument();
      expect(screen.getByText('Why are you reporting this content?')).toBeInTheDocument();
    });

    it('shows all report reason options', async () => {
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      expect(screen.getByText('Inappropriate Content')).toBeInTheDocument();
      expect(screen.getByText('Misinformation')).toBeInTheDocument();
      expect(screen.getByText('Spam')).toBeInTheDocument();
      expect(screen.getByText('Copyright Violation')).toBeInTheDocument();
      expect(screen.getByText('Other')).toBeInTheDocument();
    });

    it('closes modal when cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));
      expect(screen.getByText('Report Content')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText('Report Content')).not.toBeInTheDocument();
      });
    });

    it('closes modal when X button is clicked', async () => {
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      // Find the X button (the × character)
      const closeButton = screen.getByRole('button', { name: /×/i });
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('Report Content')).not.toBeInTheDocument();
      });
    });
  });

  describe('form validation', () => {
    it('disables submit button when no reason is selected', async () => {
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      // Submit button should be disabled when no reason is selected
      const submitButton = screen.getByRole('button', { name: /submit report/i });
      expect(submitButton).toBeDisabled();
    });

    it('allows submission after selecting a reason', async () => {
      mockCreateContentReportAction.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      // Select a reason
      const inappropriateLabel = screen.getByText('Inappropriate Content').closest('label');
      expect(inappropriateLabel).toBeInTheDocument();
      const radioInput = within(inappropriateLabel!).getByRole('radio');
      await user.click(radioInput);

      await user.click(screen.getByRole('button', { name: /submit report/i }));

      await waitFor(() => {
        expect(mockCreateContentReportAction).toHaveBeenCalled();
      });
    });
  });

  describe('submission', () => {
    it('calls createContentReportAction with correct data', async () => {
      mockCreateContentReportAction.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={456} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      // Select misinformation reason
      const misinfoLabel = screen.getByText('Misinformation').closest('label');
      const radioInput = within(misinfoLabel!).getByRole('radio');
      await user.click(radioInput);

      // Add details
      const textarea = screen.getByPlaceholderText(/provide any additional context/i);
      await user.type(textarea, 'This content contains false information');

      await user.click(screen.getByRole('button', { name: /submit report/i }));

      await waitFor(() => {
        expect(mockCreateContentReportAction).toHaveBeenCalledWith({
          explanation_id: 456,
          reason: 'misinformation',
          details: 'This content contains false information',
        });
      });
    });

    it('shows loading state during submission', async () => {
      // Make the action hang
      mockCreateContentReportAction.mockImplementation(() => new Promise(() => {}));
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      const spamLabel = screen.getByText('Spam').closest('label');
      const radioInput = within(spamLabel!).getByRole('radio');
      await user.click(radioInput);

      await user.click(screen.getByRole('button', { name: /submit report/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /submitting/i })).toBeInTheDocument();
      });
    });

    it('shows success message after successful submission', async () => {
      mockCreateContentReportAction.mockResolvedValue({ success: true });
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      const otherLabel = screen.getByText('Other').closest('label');
      const radioInput = within(otherLabel!).getByRole('radio');
      await user.click(radioInput);

      await user.click(screen.getByRole('button', { name: /submit report/i }));

      await waitFor(() => {
        expect(screen.getByText(/thank you for your report/i)).toBeInTheDocument();
      });
    });

    it('shows error message on submission failure', async () => {
      mockCreateContentReportAction.mockResolvedValue({
        success: false,
        error: { message: 'Server error occurred' }
      });
      const user = userEvent.setup();
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      const copyrightLabel = screen.getByText('Copyright Violation').closest('label');
      const radioInput = within(copyrightLabel!).getByRole('radio');
      await user.click(radioInput);

      await user.click(screen.getByRole('button', { name: /submit report/i }));

      await waitFor(() => {
        expect(screen.getByText('Server error occurred')).toBeInTheDocument();
      });
    });
  });

  describe('modal closes after success', () => {
    it('closes modal automatically after showing success message', async () => {
      jest.useFakeTimers();
      mockCreateContentReportAction.mockResolvedValue({ success: true });
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      render(<ReportContentButton explanationId={123} />);

      await user.click(screen.getByRole('button', { name: /report this content/i }));

      const inappropriateLabel = screen.getByText('Inappropriate Content').closest('label');
      const radioInput = within(inappropriateLabel!).getByRole('radio');
      await user.click(radioInput);

      await user.click(screen.getByRole('button', { name: /submit report/i }));

      await waitFor(() => {
        expect(screen.getByText(/thank you for your report/i)).toBeInTheDocument();
      });

      // Modal should close after 2 seconds
      jest.advanceTimersByTime(2100);

      await waitFor(() => {
        expect(screen.queryByText('Report Content')).not.toBeInTheDocument();
      });

      jest.useRealTimers();
    });
  });
});
