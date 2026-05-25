// Unit tests for ForgotPasswordForm — render states, submit success, error masking,
// and the back-to-login link.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { requestPasswordReset } from '../login/actions';

jest.mock('../login/actions', () => ({
  requestPasswordReset: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), refresh: jest.fn() })),
}));

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requestPasswordReset as jest.Mock).mockResolvedValue({ success: true });
  });

  it('renders email input, submit button, and back-to-login link', () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByTestId('forgot-password-email')).toBeInTheDocument();
    expect(screen.getByTestId('forgot-password-submit')).toBeInTheDocument();
    expect(screen.getByTestId('back-to-login')).toHaveAttribute('href', '/login');
  });

  it('submits the email and shows a generic success message', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.type(screen.getByTestId('forgot-password-email'), 'user@example.com');
    await user.click(screen.getByTestId('forgot-password-submit'));

    await waitFor(() => {
      expect(requestPasswordReset).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('forgot-password-success')).toHaveTextContent(
      /if an account exists/i,
    );
  });

  it('shows a form-level error when the action returns one', async () => {
    (requestPasswordReset as jest.Mock).mockResolvedValue({ error: 'Unable to determine site URL' });
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.type(screen.getByTestId('forgot-password-email'), 'user@example.com');
    await user.click(screen.getByTestId('forgot-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('forgot-password-error')).toHaveTextContent(
        /unable to determine site url/i,
      );
    });
    // Success state never rendered
    expect(screen.queryByTestId('forgot-password-success')).not.toBeInTheDocument();
  });

  it('blocks invalid emails at the schema layer (no action call)', async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    // Empty email — RHF + zodResolver should block submission
    await user.click(screen.getByTestId('forgot-password-submit'));

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });
    expect(requestPasswordReset).not.toHaveBeenCalled();
  });
});
