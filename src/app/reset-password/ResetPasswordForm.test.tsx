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
      verifyOtp: jest.fn(),
      getUser: jest.fn(),
      signInWithPassword: jest.fn(),
    },
  },
}));

jest.mock('@/hooks/useUserAuth', () => ({
  useIsGuest: jest.fn(),
}));

const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({ push: mockPush, refresh: mockRefresh, replace: mockReplace })),
  useSearchParams: jest.fn(() => mockSearchParams),
}));

// window.location.assign drives the post-reset hard nav. JSDom locks the
// Location object down, so don't try to spy on it — E2E covers the actual
// navigation. Tests below just verify the SDK calls and form state.

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
    mockSearchParams = new URLSearchParams();
    (useIsGuest as jest.Mock).mockReturnValue(false);
    (supabase_browser.auth.updateUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    });
    (supabase_browser.auth.verifyOtp as jest.Mock).mockResolvedValue({
      data: { user: { id: 'u1' }, session: { access_token: 'a', refresh_token: 'r' } },
      error: null,
    });
    (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'u1', email: 'recover@example.com' } },
      error: null,
    });
    (supabase_browser.auth.signInWithPassword as jest.Mock).mockResolvedValue({
      data: { user: { id: 'u1' }, session: { access_token: 'a', refresh_token: 'r' } },
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

  it('refuses to updateUser when the submit-time session is the guest (guard against clobbering the shared guest)', async () => {
    // Form renders enabled (recovery fired, not guest at render), but the session
    // has been displaced to the guest by the time onSubmit reads getUser() — the
    // exact prod race that broke demo autologin. The guard must abort updateUser.
    const prevGuestEmail = process.env.NEXT_PUBLIC_GUEST_EMAIL;
    process.env.NEXT_PUBLIC_GUEST_EMAIL = 'guest@explainanything.app';
    (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: { id: 'guest', email: 'guest@explainanything.app' } },
      error: null,
    });
    try {
      const { fire } = setupAuthChange();
      const user = userEvent.setup();
      render(<ResetPasswordForm />);
      fire('PASSWORD_RECOVERY');

      await user.type(screen.getByTestId('reset-password-new'), 'NewStrongPass1');
      await user.type(screen.getByTestId('reset-password-confirm'), 'NewStrongPass1');
      await user.click(screen.getByTestId('reset-password-submit'));

      await waitFor(() => {
        expect(screen.getByTestId('reset-password-error')).toHaveTextContent(/no longer valid/i);
      });
      expect(supabase_browser.auth.updateUser).not.toHaveBeenCalled();
      expect(supabase_browser.auth.signInWithPassword).not.toHaveBeenCalled();
    } finally {
      process.env.NEXT_PUBLIC_GUEST_EMAIL = prevGuestEmail;
    }
  });

  it('refuses to updateUser when there is no active session', async () => {
    (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const { fire } = setupAuthChange();
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    fire('PASSWORD_RECOVERY');

    await user.type(screen.getByTestId('reset-password-new'), 'NewStrongPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewStrongPass1');
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-password-error')).toHaveTextContent(/no longer valid/i);
    });
    expect(supabase_browser.auth.updateUser).not.toHaveBeenCalled();
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

  it('calls updateUser, re-signs in with the new password, and routes to / on success', async () => {
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
    await waitFor(() => {
      expect(supabase_browser.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'recover@example.com',
        password: 'NewStrongPass1',
      });
    });
    // Hard nav to / is verified by E2E (JSDom blocks mocking window.location.assign).
  });

  it('surfaces a re-sign-in error after a successful password update', async () => {
    (supabase_browser.auth.signInWithPassword as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: 'rate limit exceeded' },
    });
    const { fire } = setupAuthChange();
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    fire('PASSWORD_RECOVERY');

    await user.type(screen.getByTestId('reset-password-new'), 'NewStrongPass1');
    await user.type(screen.getByTestId('reset-password-confirm'), 'NewStrongPass1');
    await user.click(screen.getByTestId('reset-password-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('reset-password-error')).toHaveTextContent(/rate limit exceeded/i);
    });
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
  });

  it('calls verifyOtp client-side when arriving with token_hash + type=recovery, then strips the params', async () => {
    mockSearchParams = new URLSearchParams({ token_hash: 'recov_abc', type: 'recovery' });
    setupAuthChange();
    render(<ResetPasswordForm />);

    await waitFor(() => {
      expect(supabase_browser.auth.verifyOtp).toHaveBeenCalledWith({
        type: 'recovery',
        token_hash: 'recov_abc',
      });
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/reset-password');
    });
  });

  it('does not call verifyOtp when no recovery params are present', async () => {
    setupAuthChange();
    render(<ResetPasswordForm />);
    // Allow any pending microtasks to run before asserting.
    await Promise.resolve();
    expect(supabase_browser.auth.verifyOtp).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('leaves the invalid-link message in place when verifyOtp fails', async () => {
    mockSearchParams = new URLSearchParams({ token_hash: 'recov_bad', type: 'recovery' });
    (supabase_browser.auth.verifyOtp as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: 'Email link is invalid or has expired' },
    });
    setupAuthChange();
    render(<ResetPasswordForm />);

    await waitFor(() => {
      expect(supabase_browser.auth.verifyOtp).toHaveBeenCalled();
    });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('reset-password-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-password-submit')).not.toBeInTheDocument();
  });
});
