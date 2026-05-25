// Unit tests for ResetPasswordForm — verifies the client-side double gate
// (PASSWORD_RECOVERY event + non-guest user), successful update flow, and
// error handling.

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResetPasswordForm } from './ResetPasswordForm';
import { supabase_browser } from '@/lib/supabase';
import { useIsGuest } from '@/hooks/useUserAuth';

jest.mock('@/lib/supabase', () => ({
  supabase_browser: {
    auth: {
      onAuthStateChange: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

jest.mock('@/hooks/useUserAuth', () => ({
  useIsGuest: jest.fn(),
}));

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: mockPush, refresh: mockRefresh })),
}));

type AuthCallback = (event: string, session: unknown) => void;

function setupAuthChange(): { fire: (event: string) => void } {
  let cb: AuthCallback | null = null;
  (supabase_browser.auth.onAuthStateChange as jest.Mock).mockImplementation(
    (callback: AuthCallback) => {
      cb = callback;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    },
  );
  return {
    fire: (event: string) => {
      if (cb) act(() => cb!(event, null));
    },
  };
}

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useIsGuest as jest.Mock).mockReturnValue(false);
    (supabase_browser.auth.updateUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    });
  });

  it('shows the invalid-link message before PASSWORD_RECOVERY fires', () => {
    setupAuthChange();
    render(<ResetPasswordForm />);
    expect(screen.getByTestId('reset-password-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-password-submit')).not.toBeInTheDocument();
    expect(screen.getByTestId('reset-password-request-new')).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('enables the form after PASSWORD_RECOVERY fires', () => {
    const { fire } = setupAuthChange();
    render(<ResetPasswordForm />);

    fire('PASSWORD_RECOVERY');

    expect(screen.getByTestId('reset-password-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-password-invalid')).not.toBeInTheDocument();
  });

  it('keeps the form disabled when the current user is the guest', () => {
    (useIsGuest as jest.Mock).mockReturnValue(true);
    const { fire } = setupAuthChange();
    render(<ResetPasswordForm />);

    fire('PASSWORD_RECOVERY');

    expect(screen.getByTestId('reset-password-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-password-submit')).not.toBeInTheDocument();
  });

  it('rejects mismatched passwords at the schema layer', async () => {
    const { fire } = setupAuthChange();
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    fire('PASSWORD_RECOVERY');

    await user.type(screen.getByTestId('reset-password-new'), 'StrongPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'DifferentPass2');
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(screen.getByText(/passwords don't match/i)).toBeInTheDocument();
    });
    expect(supabase_browser.auth.updateUser).not.toHaveBeenCalled();
  });

  it('rejects weak passwords at the schema layer (no upper case)', async () => {
    const { fire } = setupAuthChange();
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    fire('PASSWORD_RECOVERY');

    await user.type(screen.getByTestId('reset-password-new'), 'weakpass123');
    await user.type(screen.getByTestId('reset-password-confirm'), 'weakpass123');
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(screen.getByText(/uppercase letter/i)).toBeInTheDocument();
    });
    expect(supabase_browser.auth.updateUser).not.toHaveBeenCalled();
  });

  it('calls updateUser and routes to / on success', async () => {
    const { fire } = setupAuthChange();
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    fire('PASSWORD_RECOVERY');

    await user.type(screen.getByTestId('reset-password-new'), 'NewStrongPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewStrongPass1');
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(supabase_browser.auth.updateUser).toHaveBeenCalledWith({
        password: 'NewStrongPass1',
      });
    });
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('surfaces Supabase errors instead of routing', async () => {
    (supabase_browser.auth.updateUser as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: 'session expired' },
    });
    const { fire } = setupAuthChange();
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    fire('PASSWORD_RECOVERY');

    await user.type(screen.getByTestId('reset-password-new'), 'NewStrongPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewStrongPass1');
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-password-error')).toHaveTextContent(/session expired/i);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
