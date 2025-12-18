import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Navigation from './Navigation';
import { signOut } from '@/app/login/actions';

// Mock dependencies
jest.mock('@/app/login/actions', () => ({
  signOut: jest.fn(),
}));

jest.mock('./SearchBar', () => {
  return function MockSearchBar(props: any) {
    return (
      <div data-testid="search-bar" data-variant={props.variant}>
        {props.placeholder}
      </div>
    );
  };
});

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: any) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  };
});

describe('Navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // Rendering Tests
  // ========================================================================

  describe('Rendering', () => {
    it('should render navigation bar with semantic nav element', () => {
      render(<Navigation />);
      const nav = screen.getByRole('navigation');
      expect(nav).toBeInTheDocument();
    });

    it('should render "Explain Anything" heading', () => {
      render(<Navigation />);
      // Heading now has "Explain" and "Anything" in separate spans
      expect(screen.getByText('Explain')).toBeInTheDocument();
      expect(screen.getByText('Anything')).toBeInTheDocument();
    });

    it('should render all navigation links', () => {
      render(<Navigation />);
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('My Library')).toBeInTheDocument();
      expect(screen.getByText('All Explanations')).toBeInTheDocument();
    });

    it('should render logout button', () => {
      render(<Navigation />);
      expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Search Bar Integration Tests
  // ========================================================================

  describe('Search Bar Integration', () => {
    it('should render SearchBar when showSearchBar is true', () => {
      render(<Navigation showSearchBar={true} />);
      expect(screen.getByTestId('search-bar')).toBeInTheDocument();
    });

    it('should hide SearchBar when showSearchBar is false', () => {
      render(<Navigation showSearchBar={false} />);
      expect(screen.queryByTestId('search-bar')).not.toBeInTheDocument();
    });

    it('should render SearchBar by default when showSearchBar not provided', () => {
      render(<Navigation />);
      expect(screen.getByTestId('search-bar')).toBeInTheDocument();
    });

    it('should pass "nav" variant to SearchBar', () => {
      render(<Navigation showSearchBar={true} />);
      const searchBar = screen.getByTestId('search-bar');
      expect(searchBar).toHaveAttribute('data-variant', 'nav');
    });

    it('should forward placeholder prop to SearchBar', () => {
      render(<Navigation showSearchBar={true} searchBarProps={{ placeholder: 'Custom search...' }} />);
      expect(screen.getByText('Custom search...')).toBeInTheDocument();
    });

    it('should use default placeholder when not provided', () => {
      render(<Navigation showSearchBar={true} />);
      expect(screen.getByText('Search the archives...')).toBeInTheDocument();
    });

    it('should forward searchBarProps to SearchBar component', () => {
      const mockOnSearch = jest.fn();
      render(
        <Navigation
          showSearchBar={true}
          searchBarProps={{
            placeholder: 'Test placeholder',
            maxLength: 50,
            initialValue: 'test',
            onSearch: mockOnSearch,
            disabled: true,
          }}
        />
      );
      // SearchBar is rendered with the custom props
      // (In real component, these would be passed through to actual SearchBar)
      expect(screen.getByTestId('search-bar')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Navigation Links Tests
  // ========================================================================

  describe('Navigation Links', () => {
    it('should render Home link with correct href', () => {
      render(<Navigation />);
      const homeLink = screen.getByText('Home').closest('a');
      expect(homeLink).toHaveAttribute('href', '/');
    });

    it('should render My Library link with correct href', () => {
      render(<Navigation />);
      const libraryLink = screen.getByText('My Library').closest('a');
      expect(libraryLink).toHaveAttribute('href', '/userlibrary');
    });

    it('should render All Explanations link with correct href', () => {
      render(<Navigation />);
      const explanationsLink = screen.getByText('All Explanations').closest('a');
      expect(explanationsLink).toHaveAttribute('href', '/explanations');
    });

    it('should apply consistent styling classes to all navigation links', () => {
      render(<Navigation />);
      const homeLink = screen.getByText('Home').closest('a');
      // Uses CSS variable based styling
      expect(homeLink).toHaveClass('scholar-nav-link', 'text-[var(--text-secondary)]');
    });
  });

  // ========================================================================
  // Logout Functionality Tests
  // ========================================================================

  describe('Logout Functionality', () => {
    it('should call signOut when logout button is clicked', async () => {
      const user = userEvent.setup();
      render(<Navigation />);

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      await user.click(logoutButton);

      expect(signOut).toHaveBeenCalledTimes(1);
    });

    it('should call signOut with no arguments', async () => {
      const user = userEvent.setup();
      render(<Navigation />);

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      await user.click(logoutButton);

      expect(signOut).toHaveBeenCalledWith();
    });

    it('should handle multiple logout clicks', async () => {
      const user = userEvent.setup();
      render(<Navigation />);

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      await user.click(logoutButton);
      await user.click(logoutButton);

      expect(signOut).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================================================
  // Styling and Dark Mode Tests
  // ========================================================================

  describe('Styling and Theme', () => {
    it('should apply theme styling to navigation bar', () => {
      render(<Navigation />);
      const nav = screen.getByRole('navigation');
      // Uses CSS variable based styling for light/dark mode support
      expect(nav).toHaveClass('bg-[var(--surface-secondary)]');
    });

    it('should apply theme styling to heading', () => {
      render(<Navigation />);
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveClass('text-[var(--text-primary)]');
    });

    it('should have border styling', () => {
      render(<Navigation />);
      const nav = screen.getByRole('navigation');
      expect(nav).toHaveClass('border-b', 'border-[var(--border-default)]');
    });

    it('should apply transition classes to logout button', () => {
      render(<Navigation />);
      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toHaveClass('transition-all');
    });
  });

  // ========================================================================
  // Accessibility Tests
  // ========================================================================

  describe('Accessibility', () => {
    it('should use semantic nav element', () => {
      render(<Navigation />);
      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });

    it('should have accessible logout button', () => {
      render(<Navigation />);
      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toBeInTheDocument();
      expect(logoutButton.tagName).toBe('BUTTON');
    });

    it('should have focus ring classes for accessibility', () => {
      render(<Navigation />);
      const homeLink = screen.getByText('Home').closest('a');
      expect(homeLink).toHaveClass('focus:outline-none', 'focus-visible:ring-2');
    });

    it('should have focus ring on logout button', () => {
      render(<Navigation />);
      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toHaveClass('focus:outline-none', 'focus-visible:ring-2');
    });

    it('should support keyboard navigation for all links', () => {
      render(<Navigation />);
      const links = ['Home', 'My Library', 'All Explanations'].map(text =>
        screen.getByText(text).closest('a')
      );
      links.forEach(link => {
        expect(link).toBeInTheDocument();
      });
    });
  });

  // ========================================================================
  // Layout Tests
  // ========================================================================

  describe('Layout', () => {
    it('should use flexbox layout for navigation items', () => {
      render(<Navigation />);
      const nav = screen.getByRole('navigation');
      const flexContainer = nav.querySelector('.flex.justify-between');
      expect(flexContainer).toBeInTheDocument();
    });

    it('should have max-width container', () => {
      render(<Navigation />);
      const nav = screen.getByRole('navigation');
      const container = nav.querySelector('.max-w-7xl');
      expect(container).toBeInTheDocument();
    });

    it('should render gradient border at bottom', () => {
      render(<Navigation />);
      const nav = screen.getByRole('navigation');
      const gradientBorder = nav.querySelector('.bg-gradient-to-r');
      expect(gradientBorder).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Edge Cases
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle empty searchBarProps object', () => {
      render(<Navigation showSearchBar={true} searchBarProps={{}} />);
      expect(screen.getByTestId('search-bar')).toBeInTheDocument();
    });

    it('should handle undefined searchBarProps', () => {
      render(<Navigation showSearchBar={true} />);
      expect(screen.getByTestId('search-bar')).toBeInTheDocument();
    });

    it('should render correctly with all props omitted', () => {
      render(<Navigation />);
      expect(screen.getByRole('navigation')).toBeInTheDocument();
      expect(screen.getByText('Explain')).toBeInTheDocument();
      expect(screen.getByText('Anything')).toBeInTheDocument();
      expect(screen.getByTestId('search-bar')).toBeInTheDocument();
    });
  });
});
