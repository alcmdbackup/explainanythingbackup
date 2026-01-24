/**
 * Unit tests for the Home page component - testing tabbed interface structure.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Home from './page';

// Mock the components
jest.mock('@/components/Navigation', () => {
    return function MockNavigation({ showSearchBar }: { showSearchBar?: boolean }) {
        return <nav data-testid="navigation" data-show-search-bar={showSearchBar}>Navigation</nav>;
    };
});

jest.mock('@/components/home', () => ({
    HomeTabs: function MockHomeTabs({ activeTab, onTabChange }: { activeTab: string; onTabChange: (tab: string) => void }) {
        return (
            <div role="tablist" data-testid="home-tabs" data-active-tab={activeTab}>
                <button
                    role="tab"
                    data-testid="home-tab-search"
                    aria-selected={activeTab === 'search'}
                    onClick={() => onTabChange('search')}
                >
                    Search
                </button>
                <button
                    role="tab"
                    data-testid="home-tab-import"
                    aria-selected={activeTab === 'import'}
                    onClick={() => onTabChange('import')}
                >
                    Import
                </button>
            </div>
        );
    },
    HomeSearchPanel: function MockHomeSearchPanel({ query, onQueryChange }: { query: string; onQueryChange: (q: string) => void }) {
        return (
            <div id="search-panel" role="tabpanel" data-testid="home-search-panel" aria-labelledby="search-tab">
                <input
                    data-testid="home-search-input"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="What would you like to learn?"
                />
            </div>
        );
    },
    HomeImportPanel: function MockHomeImportPanel() {
        return (
            <div id="import-panel" role="tabpanel" data-testid="home-import-panel" aria-labelledby="import-tab">
                Import Panel
            </div>
        );
    },
}));

jest.mock('@/components/import/ImportPreview', () => {
    return function MockImportPreview() {
        return null;
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

        it('should render HomeTabs component', () => {
            render(<Home />);

            const tabs = screen.getByTestId('home-tabs');
            expect(tabs).toBeInTheDocument();
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

    describe('Tab Integration', () => {
        it('should show Search tab as default', () => {
            render(<Home />);

            const tabs = screen.getByTestId('home-tabs');
            expect(tabs).toHaveAttribute('data-active-tab', 'search');
        });

        it('should render Search panel when Search tab is active', () => {
            render(<Home />);

            const searchPanel = screen.getByTestId('home-search-panel');
            expect(searchPanel).toBeInTheDocument();
        });

        it('should switch to Import tab when clicked', async () => {
            const user = userEvent.setup();
            render(<Home />);

            await user.click(screen.getByTestId('home-tab-import'));

            const tabs = screen.getByTestId('home-tabs');
            expect(tabs).toHaveAttribute('data-active-tab', 'import');
        });

        it('should render Import panel when Import tab is active', async () => {
            const user = userEvent.setup();
            render(<Home />);

            await user.click(screen.getByTestId('home-tab-import'));

            const importPanel = screen.getByTestId('home-import-panel');
            expect(importPanel).toBeInTheDocument();
        });

        it('should render tabs in the main content area', () => {
            const { container } = render(<Home />);

            const main = container.querySelector('main');
            const tabs = screen.getByTestId('home-tabs');

            expect(main).toContainElement(tabs);
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

        it('should render Search panel inside main content', () => {
            const { container } = render(<Home />);

            const main = container.querySelector('main');
            const searchPanel = screen.getByTestId('home-search-panel');

            expect(main).toContainElement(searchPanel);
        });

        it('should have proper width constraints on panel container', () => {
            render(<Home />);

            const panelParent = screen.getByTestId('home-search-panel').parentElement;
            expect(panelParent).toHaveClass('w-full');
        });
    });

    describe('State Management', () => {
        it('should preserve search query when switching tabs', async () => {
            const user = userEvent.setup();
            render(<Home />);

            // Type in search input
            const searchInput = screen.getByTestId('home-search-input');
            await user.type(searchInput, 'quantum physics');

            // Switch to Import tab
            await user.click(screen.getByTestId('home-tab-import'));

            // Switch back to Search tab
            await user.click(screen.getByTestId('home-tab-search'));

            // Query should be preserved
            expect(screen.getByTestId('home-search-input')).toHaveValue('quantum physics');
        });
    });
});
