import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from './page';
import { login, signup } from './actions';
import { setRememberMe, clearSupabaseLocalStorage } from '@/lib/utils/supabase/rememberMe';

// Mock the login actions
jest.mock('./actions', () => ({
  login: jest.fn(),
  signup: jest.fn(),
}));

// Mock rememberMe utilities
jest.mock('@/lib/utils/supabase/rememberMe', () => ({
  setRememberMe: jest.fn(),
  clearSupabaseLocalStorage: jest.fn(),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
  })),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (login as jest.Mock).mockResolvedValue({});
    (signup as jest.Mock).mockResolvedValue({});
  });

  describe('Rendering', () => {
    it('should render login form with hero layout', () => {
      render(<LoginPage />);

      // Title and submit button both say "Sign In" / "Welcome Back"
      expect(screen.getAllByText(/sign in/i).length).toBeGreaterThan(0);
      expect(
        screen.getByText('Welcome Back')
      ).toBeInTheDocument();
    });

    it('should render email input', () => {
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      expect(emailInput).toBeInTheDocument();
      expect(emailInput).toHaveAttribute('type', 'email');
      expect(emailInput).toHaveAttribute('id', 'email');
    });

    it('should render password input', () => {
      render(<LoginPage />);

      const passwordInput = screen.getByLabelText(/^password$/i);
      expect(passwordInput).toBeInTheDocument();
      expect(passwordInput).toHaveAttribute('type', 'password');
      expect(passwordInput).toHaveAttribute('id', 'password');
    });

    it('should render sign in button', () => {
      render(<LoginPage />);

      const loginButton = screen.getByRole('button', { name: /sign in/i });
      expect(loginButton).toBeInTheDocument();
    });

    it('should render signup toggle button', () => {
      render(<LoginPage />);

      const signupButton = screen.getByRole('button', {
        name: /new here\? create account/i,
      });
      expect(signupButton).toBeInTheDocument();
    });
  });

  describe('Form Fields', () => {
    it('should accept email input', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
      await user.type(emailInput, 'test@example.com');

      expect(emailInput.value).toBe('test@example.com');
    });

    it('should accept password input', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const passwordInput = screen.getByLabelText(
        /^password$/i
      ) as HTMLInputElement;
      await user.type(passwordInput, 'secretpassword');

      expect(passwordInput.value).toBe('secretpassword');
    });

    it('should mask password input by default', () => {
      render(<LoginPage />);

      const passwordInput = screen.getByLabelText(/^password$/i);
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('should handle special characters in password', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const passwordInput = screen.getByLabelText(
        /^password$/i
      ) as HTMLInputElement;
      await user.type(passwordInput, 'P@ssw0rd!#$%');

      expect(passwordInput.value).toBe('P@ssw0rd!#$%');
    });
  });

  describe('Password Visibility Toggle', () => {
    it('should toggle password visibility when eye icon is clicked', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const passwordInput = screen.getByLabelText(/^password$/i);
      const toggleButton = screen.getByRole('button', {
        name: /show password/i,
      });

      expect(passwordInput).toHaveAttribute('type', 'password');

      await user.click(toggleButton);
      expect(passwordInput).toHaveAttribute('type', 'text');

      await user.click(toggleButton);
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('should have accessible aria-label on toggle button', () => {
      render(<LoginPage />);

      const toggleButton = screen.getByRole('button', {
        name: /show password/i,
      });
      expect(toggleButton).toHaveAttribute('aria-label', 'Show password');
    });
  });

  describe('Remember Me Feature', () => {
    it('should render remember me checkbox in login mode', () => {
      render(<LoginPage />);

      const rememberMeCheckbox = screen.getByRole('checkbox', {
        name: /remember me/i,
      });
      expect(rememberMeCheckbox).toBeInTheDocument();
    });

    it('should toggle remember me checkbox', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const rememberMeCheckbox = screen.getByRole('checkbox', {
        name: /remember me/i,
      });

      expect(rememberMeCheckbox).not.toBeChecked();

      await user.click(rememberMeCheckbox);
      expect(rememberMeCheckbox).toBeChecked();

      await user.click(rememberMeCheckbox);
      expect(rememberMeCheckbox).not.toBeChecked();
    });

    it('should not show remember me in signup mode', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const signupToggle = screen.getByRole('button', {
        name: /new here\? create account/i,
      });
      await user.click(signupToggle);

      // Wait for transition
      await waitFor(() => {
        expect(screen.getByText('Begin Your Journey')).toBeInTheDocument();
      });

      const rememberMeCheckbox = screen.queryByRole('checkbox', {
        name: /remember me/i,
      });
      expect(rememberMeCheckbox).not.toBeInTheDocument();
    });

    it('should call setRememberMe with true when checkbox is checked on login', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const rememberMeCheckbox = screen.getByRole('checkbox', { name: /remember me/i });
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(rememberMeCheckbox);
      await user.click(submitButton);

      await waitFor(() => {
        expect(setRememberMe).toHaveBeenCalledWith(true);
      });
    });

    it('should call setRememberMe with false when checkbox is unchecked on login', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      await waitFor(() => {
        expect(setRememberMe).toHaveBeenCalledWith(false);
      });
    });

    it('should call clearSupabaseLocalStorage when remember me is unchecked', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      // rememberMe is false by default
      await user.click(submitButton);

      await waitFor(() => {
        expect(clearSupabaseLocalStorage).toHaveBeenCalled();
      });
    });

    it('should not call clearSupabaseLocalStorage when remember me is checked', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const rememberMeCheckbox = screen.getByRole('checkbox', { name: /remember me/i });
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(rememberMeCheckbox);
      await user.click(submitButton);

      await waitFor(() => {
        expect(setRememberMe).toHaveBeenCalledWith(true);
      });
      expect(clearSupabaseLocalStorage).not.toHaveBeenCalled();
    });

    it('should not call setRememberMe during signup', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      // Switch to signup mode
      const signupToggle = screen.getByRole('button', {
        name: /new here\? create account/i,
      });
      await user.click(signupToggle);

      await waitFor(() => {
        expect(screen.getByText('Begin Your Journey')).toBeInTheDocument();
      });

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /create account/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      await waitFor(() => {
        expect(signup).toHaveBeenCalled();
      });
      expect(setRememberMe).not.toHaveBeenCalled();
    });
  });

  describe('Forgot Password Link', () => {
    it('should render forgot password link in login mode', () => {
      render(<LoginPage />);

      const forgotLink = screen.getByRole('link', { name: /forgot password/i });
      expect(forgotLink).toBeInTheDocument();
      expect(forgotLink).toHaveAttribute('href', '/forgot-password');
    });

    it('should not show forgot password link in signup mode', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const signupToggle = screen.getByRole('button', {
        name: /new here\? create account/i,
      });
      await user.click(signupToggle);

      // Wait for transition
      await waitFor(() => {
        expect(screen.getByText('Begin Your Journey')).toBeInTheDocument();
      });

      const forgotLink = screen.queryByRole('link', {
        name: /forgot password/i,
      });
      expect(forgotLink).not.toBeInTheDocument();
    });
  });

  describe('Login/Signup Mode Toggle', () => {
    it('should switch from login to signup mode', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      // Verify we start in login mode
      expect(screen.getAllByText(/sign in/i).length).toBeGreaterThan(0);

      const signupToggle = screen.getByRole('button', {
        name: /new here\? create account/i,
      });
      await user.click(signupToggle);

      // Wait for transition (200ms) plus render
      await waitFor(() => {
        expect(screen.getByText('Begin Your Journey')).toBeInTheDocument();
        expect(
          screen.getByText('Create your scholarly account')
        ).toBeInTheDocument();
      });
    });

    it('should switch from signup back to login mode', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const signupToggle = screen.getByRole('button', {
        name: /new here\? create account/i,
      });
      await user.click(signupToggle);

      // Wait for transition
      await waitFor(() => {
        expect(screen.getByRole('button', {
          name: /already have an account\? sign in/i,
        })).toBeInTheDocument();
      });

      const loginToggle = screen.getByRole('button', {
        name: /already have an account\? sign in/i,
      });
      await user.click(loginToggle);

      // Wait for transition back
      await waitFor(() => {
        expect(screen.getAllByText(/sign in/i).length).toBeGreaterThan(0);
      });
    });
  });

  describe('Form Validation', () => {
    it('should show validation error for invalid email', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
      const form = emailInput.closest('form') as HTMLFormElement;

      await user.type(emailInput, 'invalid-email');
      // Verify the input has the value
      expect(emailInput.value).toBe('invalid-email');

      // Submit the form directly instead of clicking button
      // to bypass any native HTML5 validation in the test environment
      fireEvent.submit(form);

      await waitFor(() => {
        expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should show validation error for short password', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(passwordInput, 'short');
      await user.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText(/password must be at least 8 characters/i)
        ).toBeInTheDocument();
      });
    });

    it('should show validation error for empty email', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const submitButton = screen.getByRole('button', { name: /sign in/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      });
    });
  });

  describe('Form Submission', () => {
    it('should call login action with valid credentials', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      await waitFor(() => {
        expect(login).toHaveBeenCalled();
      });
    });

    it('should call signup action when in signup mode', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const signupToggle = screen.getByRole('button', {
        name: /new here\? create account/i,
      });
      await user.click(signupToggle);

      // Wait for transition
      await waitFor(() => {
        expect(screen.getByText('Begin Your Journey')).toBeInTheDocument();
      });

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /create account/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      await waitFor(() => {
        expect(signup).toHaveBeenCalled();
      });
    });

    it('should display success message after successful signup', async () => {
      const user = userEvent.setup();
      (signup as jest.Mock).mockResolvedValue({ success: true });

      render(<LoginPage />);

      const signupToggle = screen.getByRole('button', {
        name: /new here\? create account/i,
      });
      await user.click(signupToggle);

      // Wait for transition
      await waitFor(() => {
        expect(screen.getByText('Begin Your Journey')).toBeInTheDocument();
      });

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /create account/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByTestId('signup-success')).toBeInTheDocument();
        expect(
          screen.getByText(/check your email for a confirmation link/i)
        ).toBeInTheDocument();
      });
    });

    it('should include rememberMe in form data when checked', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const rememberMeCheckbox = screen.getByRole('checkbox', {
        name: /remember me/i,
      });
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(rememberMeCheckbox);
      await user.click(submitButton);

      await waitFor(() => {
        expect(login).toHaveBeenCalled();
        const formData = (login as jest.Mock).mock.calls[0][0];
        expect(formData.get('rememberMe')).toBe('true');
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading state during submission', async () => {
      const user = userEvent.setup();
      (login as jest.Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/signing in/i)).toBeInTheDocument();
      });
    });

    it('should disable form during submission', async () => {
      const user = userEvent.setup();
      (login as jest.Mock).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(
        /^password$/i
      ) as HTMLInputElement;
      const submitButton = screen.getByRole('button', {
        name: /sign in/i,
      }) as HTMLButtonElement;

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'password123');
      await user.click(submitButton);

      await waitFor(() => {
        expect(emailInput).toBeDisabled();
        expect(passwordInput).toBeDisabled();
        expect(submitButton).toBeDisabled();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display server error message', async () => {
      const user = userEvent.setup();
      (login as jest.Mock).mockResolvedValue({
        error: 'Invalid email or password',
      });

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'wrongpassword');
      await user.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText('Invalid email or password')
        ).toBeInTheDocument();
      });
    });

    it('should clear error on new submission', async () => {
      const user = userEvent.setup();
      (login as jest.Mock)
        .mockResolvedValueOnce({ error: 'Invalid email or password' })
        .mockResolvedValueOnce({});

      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitButton = screen.getByRole('button', { name: /sign in/i });

      // First submission with error
      await user.type(emailInput, 'test@example.com');
      await user.type(passwordInput, 'wrongpassword');
      await user.click(submitButton);

      await waitFor(() => {
        expect(
          screen.getByText('Invalid email or password')
        ).toBeInTheDocument();
      });

      // Second submission should clear error
      await user.clear(passwordInput);
      await user.type(passwordInput, 'correctpassword');
      await user.click(submitButton);

      await waitFor(() => {
        expect(
          screen.queryByText('Invalid email or password')
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible labels for inputs', () => {
      render(<LoginPage />);

      const emailLabel = screen.getByLabelText(/email/i);
      const passwordLabel = screen.getByLabelText(/^password$/i);

      expect(emailLabel).toBeInTheDocument();
      expect(passwordLabel).toBeInTheDocument();
    });

    it('should have aria-invalid on email input when error exists', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
      const form = emailInput.closest('form') as HTMLFormElement;

      await user.type(emailInput, 'invalid');

      // Submit the form directly to bypass native HTML5 email validation
      fireEvent.submit(form);

      await waitFor(() => {
        expect(emailInput).toHaveAttribute('aria-invalid', 'true');
        expect(emailInput).toHaveAttribute('aria-describedby', 'email-error');
      }, { timeout: 3000 });
    });

    it('should support keyboard navigation', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      await user.tab(); // Header link (ExplainAnything logo)
      await user.tab(); // Email input
      expect(screen.getByLabelText(/email/i)).toHaveFocus();

      await user.tab(); // Password input
      expect(screen.getByLabelText(/^password$/i)).toHaveFocus();

      await user.tab(); // Password toggle button
      expect(
        screen.getByRole('button', { name: /show password/i })
      ).toHaveFocus();

      await user.tab(); // Remember me checkbox
      expect(
        screen.getByRole('checkbox', { name: /remember me/i })
      ).toHaveFocus();
    });
  });

  describe('Edge Cases', () => {
    it('should render with empty initial values', () => {
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
      const passwordInput = screen.getByLabelText(
        /^password$/i
      ) as HTMLInputElement;

      expect(emailInput.value).toBe('');
      expect(passwordInput.value).toBe('');
    });

    it('should handle long input values', async () => {
      const user = userEvent.setup();
      render(<LoginPage />);

      const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
      const longEmail = 'verylongemailaddress@verylongdomainname.com';

      await user.type(emailInput, longEmail);

      expect(emailInput.value).toBe(longEmail);
    });
  });
});
