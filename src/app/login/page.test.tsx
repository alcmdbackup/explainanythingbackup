import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from './page';
import { login, signup } from './actions';

// Mock the login actions
jest.mock('./actions', () => ({
    login: jest.fn(),
    signup: jest.fn()
}));

describe('LoginPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Rendering', () => {
        it('should render login form', () => {
            const { container } = render(<LoginPage />);

            const form = container.querySelector('form');
            expect(form).toBeInTheDocument();
        });

        it('should render email input', () => {
            render(<LoginPage />);

            const emailInput = screen.getByLabelText(/email/i);
            expect(emailInput).toBeInTheDocument();
            expect(emailInput).toHaveAttribute('type', 'email');
            expect(emailInput).toHaveAttribute('name', 'email');
            expect(emailInput).toHaveAttribute('id', 'email');
            expect(emailInput).toBeRequired();
        });

        it('should render password input', () => {
            render(<LoginPage />);

            const passwordInput = screen.getByLabelText(/password/i);
            expect(passwordInput).toBeInTheDocument();
            expect(passwordInput).toHaveAttribute('type', 'password');
            expect(passwordInput).toHaveAttribute('name', 'password');
            expect(passwordInput).toHaveAttribute('id', 'password');
            expect(passwordInput).toBeRequired();
        });

        it('should render log in button', () => {
            render(<LoginPage />);

            const loginButton = screen.getByRole('button', { name: /log in/i });
            expect(loginButton).toBeInTheDocument();
        });

        it('should render sign up button', () => {
            render(<LoginPage />);

            const signupButton = screen.getByRole('button', { name: /sign up/i });
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

            const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

            await user.type(passwordInput, 'secretpassword');

            expect(passwordInput.value).toBe('secretpassword');
        });

        it('should mask password input', () => {
            render(<LoginPage />);

            const passwordInput = screen.getByLabelText(/password/i);

            expect(passwordInput).toHaveAttribute('type', 'password');
        });

        it('should have required fields', () => {
            render(<LoginPage />);

            const emailInput = screen.getByLabelText(/email/i);
            const passwordInput = screen.getByLabelText(/password/i);

            expect(emailInput).toBeRequired();
            expect(passwordInput).toBeRequired();
        });
    });

    describe('Form Actions', () => {
        it('should have login formAction on log in button', () => {
            render(<LoginPage />);

            const loginButton = screen.getByRole('button', { name: /log in/i });

            expect(loginButton).toHaveAttribute('formAction');
        });

        it('should have signup formAction on sign up button', () => {
            render(<LoginPage />);

            const signupButton = screen.getByRole('button', { name: /sign up/i });

            expect(signupButton).toHaveAttribute('formAction');
        });

        it('should render both buttons inside the form', () => {
            const { container } = render(<LoginPage />);

            const form = container.querySelector('form');
            const buttons = form?.querySelectorAll('button');

            expect(buttons).toHaveLength(2);
        });
    });

    describe('Accessibility', () => {
        it('should have accessible labels for inputs', () => {
            render(<LoginPage />);

            // Labels should be associated with inputs
            const emailLabel = screen.getByLabelText(/email/i);
            const passwordLabel = screen.getByLabelText(/password/i);

            expect(emailLabel).toBeInTheDocument();
            expect(passwordLabel).toBeInTheDocument();
        });

        it('should have proper form structure', () => {
            const { container } = render(<LoginPage />);

            const form = container.querySelector('form');
            expect(form).toBeInTheDocument();

            // Should contain labels
            const labels = form?.querySelectorAll('label');
            expect(labels).toHaveLength(2);
        });

        it('should support keyboard navigation', async () => {
            const user = userEvent.setup();
            render(<LoginPage />);

            const emailInput = screen.getByLabelText(/email/i);
            const passwordInput = screen.getByLabelText(/password/i);

            // Tab through inputs
            await user.tab();
            expect(emailInput).toHaveFocus();

            await user.tab();
            expect(passwordInput).toHaveFocus();
        });
    });

    describe('Email Validation', () => {
        it('should have email type on email input', () => {
            render(<LoginPage />);

            const emailInput = screen.getByLabelText(/email/i);

            expect(emailInput).toHaveAttribute('type', 'email');
        });

        it('should have proper input names for form submission', () => {
            render(<LoginPage />);

            const emailInput = screen.getByLabelText(/email/i);
            const passwordInput = screen.getByLabelText(/password/i);

            expect(emailInput).toHaveAttribute('name', 'email');
            expect(passwordInput).toHaveAttribute('name', 'password');
        });
    });

    describe('Edge Cases', () => {
        it('should render with empty initial values', () => {
            render(<LoginPage />);

            const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
            const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

            expect(emailInput.value).toBe('');
            expect(passwordInput.value).toBe('');
        });

        it('should handle special characters in password', async () => {
            const user = userEvent.setup();
            render(<LoginPage />);

            const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

            await user.type(passwordInput, 'P@ssw0rd!#$%');

            expect(passwordInput.value).toBe('P@ssw0rd!#$%');
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
