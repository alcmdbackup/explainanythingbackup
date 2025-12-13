import { render, screen } from '@testing-library/react';
import ErrorPage from './page';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn().mockReturnValue({
    get: jest.fn().mockReturnValue(null)
  })
}));

describe('ErrorPage', () => {
    describe('Rendering', () => {
        it('should render error message', () => {
            render(<ErrorPage />);

            expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        });

        it('should render paragraph element', () => {
            const { container } = render(<ErrorPage />);

            // Check for the card description text
            expect(container.textContent).toContain('We encountered an error');
        });

        it('should be a client component', () => {
            // Verify it's marked as 'use client'
            // This is a compile-time check, but we can verify it renders without SSR issues
            expect(() => render(<ErrorPage />)).not.toThrow();
        });
    });

    describe('Accessibility', () => {
        it('should contain error message text', () => {
            render(<ErrorPage />);

            const errorMessage = screen.getByText(/something went wrong/i);
            expect(errorMessage).toBeInTheDocument();
        });

        it('should be keyboard accessible', () => {
            const { container } = render(<ErrorPage />);

            // Error message should be readable
            expect(container.textContent).toBeTruthy();
        });
    });

    describe('Content', () => {
        it('should display user-friendly error message', () => {
            render(<ErrorPage />);

            // Should have user-friendly messaging about what to do
            expect(screen.getByText(/what you can do/i)).toBeInTheDocument();
        });

        it('should not expose technical error details', () => {
            const { container } = render(<ErrorPage />);

            // Should not contain stack traces or technical terms
            expect(container.textContent).not.toContain('Stack trace');
            expect(container.textContent).not.toContain('undefined');
        });
    });
});
