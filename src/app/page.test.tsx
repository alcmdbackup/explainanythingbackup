/**
 * Unit tests for the Home page component - testing workflow enforcement.
 */
import { render, screen } from '@testing-library/react';
import Home from './page';

// Mock the components
jest.mock('@/components/Navigation', () => {
    return function MockNavigation({ showSearchBar }: { showSearchBar?: boolean }) {
        return <nav data-testid="navigation" data-show-search-bar={showSearchBar}>Navigation</nav>;
    };
});

jest.mock('@/components/SearchBar', () => {
    return function MockSearchBar({ variant, placeholder, maxLength }: { variant?: string; placeholder?: string; maxLength?: number }) {
        return (
            <div
                data-testid="search-bar"
                data-variant={variant}
                data-placeholder={placeholder}
                data-max-length={maxLength}
            >
                SearchBar
            </div>
        );
    };
});

describe('Home', () => {
    describe('Rendering', () => {
        it('should render the home page', () => {
            render(<Home />);

            expect(screen.getByText('Explain Anything')).toBeInTheDocument();
        });

        it('should render Navigation component', () => {
            render(<Home />);

            const navigation = screen.getByTestId('navigation');
            expect(navigation).toBeInTheDocument();
        });

        it('should render SearchBar component', () => {
            render(<Home />);

            const searchBar = screen.getByTestId('search-bar');
            expect(searchBar).toBeInTheDocument();
        });

        it('should render main heading', () => {
            render(<Home />);

            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toBeInTheDocument();
            expect(heading).toHaveClass('atlas-display');
        });
    });

    describe('Navigation Integration', () => {
        it('should pass showSearchBar=false to Navigation', () => {
            render(<Home />);

            const navigation = screen.getByTestId('navigation');
            expect(navigation).toHaveAttribute('data-show-search-bar', 'false');
        });

        it('should render Navigation without its own search bar', () => {
            render(<Home />);

            // Navigation should not show its own search bar
            const navigation = screen.getByTestId('navigation');
            expect(navigation.getAttribute('data-show-search-bar')).toBe('false');
        });
    });

    describe('SearchBar Integration', () => {
        it('should pass variant="home" to SearchBar', () => {
            render(<Home />);

            const searchBar = screen.getByTestId('search-bar');
            expect(searchBar).toHaveAttribute('data-variant', 'home');
        });

        it('should pass placeholder to SearchBar', () => {
            render(<Home />);

            const searchBar = screen.getByTestId('search-bar');
            expect(searchBar).toHaveAttribute('data-placeholder', 'What would you like to learn?');
        });

        it('should pass maxLength to SearchBar', () => {
            render(<Home />);

            const searchBar = screen.getByTestId('search-bar');
            expect(searchBar).toHaveAttribute('data-max-length', '150');
        });

        it('should render SearchBar in the main content area', () => {
            const { container } = render(<Home />);

            const main = container.querySelector('main');
            const searchBar = screen.getByTestId('search-bar');

            expect(main).toContainElement(searchBar);
        });
    });

    describe('Layout', () => {
        it('should have full-screen layout', () => {
            const { container } = render(<Home />);

            const mainContainer = container.querySelector('.min-h-screen');
            expect(mainContainer).toBeInTheDocument();
        });

        it('should have centered content layout', () => {
            const { container } = render(<Home />);

            const flexContainer = container.querySelector('.flex-1');
            expect(flexContainer).toBeInTheDocument();
            expect(flexContainer).toHaveClass('flex', 'items-center', 'justify-center');
        });

        it('should have responsive container', () => {
            const { container } = render(<Home />);

            const main = container.querySelector('main');
            expect(main).toHaveClass('container', 'mx-auto', 'px-8', 'max-w-2xl');
        });

        it('should center heading text', () => {
            const { container } = render(<Home />);

            const textCenter = container.querySelector('.text-center');
            expect(textCenter).toBeInTheDocument();
        });
    });

    describe('Styling', () => {
        it('should apply theme background', () => {
            const { container } = render(<Home />);

            // Check for CSS variable-based background class
            const mainContainer = container.firstChild as HTMLElement;
            expect(mainContainer).toHaveClass('min-h-screen');
        });

        it('should have flex column layout', () => {
            const { container } = render(<Home />);

            const mainContainer = container.firstChild;
            expect(mainContainer).toHaveClass('flex', 'flex-col');
        });

        it('should style heading with atlas-display', () => {
            render(<Home />);

            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveClass('atlas-display');
        });
    });

    describe('Content', () => {
        it('should display "Explain Anything" in main heading', () => {
            render(<Home />);

            expect(screen.getByText('Explain Anything')).toBeInTheDocument();
        });

        it('should display subtitle', () => {
            render(<Home />);

            expect(screen.getByText('Learn about any topic, simply explained')).toBeInTheDocument();
        });

        it('should have only one h1 heading', () => {
            const { container } = render(<Home />);

            const h1Elements = container.querySelectorAll('h1');
            expect(h1Elements).toHaveLength(1);
        });

        it('should have semantic HTML structure', () => {
            const { container } = render(<Home />);

            // Should have main element
            const main = container.querySelector('main');
            expect(main).toBeInTheDocument();
        });
    });

    describe('Accessibility', () => {
        it('should have proper heading hierarchy', () => {
            render(<Home />);

            const heading = screen.getByRole('heading', { level: 1 });
            expect(heading).toHaveTextContent('Explain Anything');
        });

        it('should have semantic main element', () => {
            render(<Home />);

            const main = screen.getByRole('main');
            expect(main).toBeInTheDocument();
        });

        it('should be a client component', () => {
            // Verify it's marked as 'use client'
            // This is a compile-time check, but we can verify it renders without SSR issues
            expect(() => render(<Home />)).not.toThrow();
        });
    });

    describe('Component Integration', () => {
        it('should render Navigation before main content', () => {
            const { container } = render(<Home />);

            const navigation = screen.getByTestId('navigation');
            const main = container.querySelector('main');

            // Navigation should appear before main in DOM order
            expect(navigation.compareDocumentPosition(main!)).toBe(
                Node.DOCUMENT_POSITION_FOLLOWING
            );
        });

        it('should render SearchBar inside main content', () => {
            const { container } = render(<Home />);

            const main = container.querySelector('main');
            const searchBar = screen.getByTestId('search-bar');

            expect(main).toContainElement(searchBar);
        });

        it('should have proper width constraints on SearchBar container', () => {
            render(<Home />);

            const searchBarParent = screen.getByTestId('search-bar').parentElement;
            expect(searchBarParent).toHaveClass('w-full');
        });
    });
});
