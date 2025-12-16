import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExplanationsTablePage from './ExplanationsTablePage';
import { formatUserFriendlyDate } from '@/lib/utils/formatDate';
import type { ExplanationFullDbType } from '@/lib/schemas/schemas';
import { ExplanationStatus } from '@/lib/schemas/schemas';

// Mock dependencies
jest.mock('@/components/Navigation', () => {
  return function MockNavigation(props: any) {
    return (
      <nav data-testid="navigation">
        Navigation Component
        {props.showSearchBar && <div data-testid="search-bar-enabled" />}
      </nav>
    );
  };
});

jest.mock('@/lib/utils/formatDate', () => ({
  formatUserFriendlyDate: jest.fn((date: string) => `Formatted: ${date}`),
}));

jest.mock('next/link', () => {
  return function MockLink({ children, href }: any) {
    return <a href={href}>{children}</a>;
  };
});

// Mock @heroicons/react/24/solid
jest.mock('@heroicons/react/24/solid', () => ({
  ArrowUpIcon: (props: any) => <span data-testid="arrow-up-icon" {...props}>↑</span>,
  ArrowDownIcon: (props: any) => <span data-testid="arrow-down-icon" {...props}>↓</span>,
}));

describe('ExplanationsTablePage', () => {
  // Helper to create mock explanation data
  const createMockExplanation = (overrides = {}): ExplanationFullDbType & { dateSaved?: string } => ({
    id: 1,
    explanation_title: 'Test Explanation',
    content: '# Test Explanation\n\nThis is test content',
    timestamp: '2024-01-01T00:00:00Z',
    primary_topic_id: 1,
    status: ExplanationStatus.Published,
    ...overrides,
  });

  const mockExplanations = [
    createMockExplanation({
      id: 1,
      explanation_title: 'Alpha Explanation',
      content: '# Alpha Explanation\n\nFirst content',
      timestamp: '2024-01-01T00:00:00Z',
    }),
    createMockExplanation({
      id: 2,
      explanation_title: 'Beta Explanation',
      content: '# Beta Explanation\n\nSecond content',
      timestamp: '2024-01-02T00:00:00Z',
    }),
    createMockExplanation({
      id: 3,
      explanation_title: 'Gamma Explanation',
      content: '# Gamma Explanation\n\nThird content',
      timestamp: '2024-01-03T00:00:00Z',
    }),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // Rendering Tests
  // ========================================================================

  describe('Rendering', () => {
    it('should render table with explanations', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('should render Navigation when showNavigation=true', () => {
      render(<ExplanationsTablePage explanations={[]} error={null} showNavigation={true} />);
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });

    it('should hide Navigation when showNavigation=false', () => {
      render(<ExplanationsTablePage explanations={[]} error={null} showNavigation={false} />);
      expect(screen.queryByTestId('navigation')).not.toBeInTheDocument();
    });

    it('should render Navigation by default', () => {
      render(<ExplanationsTablePage explanations={[]} error={null} />);
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });

    it('should use custom pageTitle', () => {
      render(<ExplanationsTablePage explanations={[]} error={null} pageTitle="My Custom Title" />);
      expect(screen.getByText('My Custom Title')).toBeInTheDocument();
    });

    it('should use default pageTitle when not provided', () => {
      render(<ExplanationsTablePage explanations={[]} error={null} />);
      expect(screen.getByText('All Explanations')).toBeInTheDocument();
    });

    it('should render table headers', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Date Created')).toBeInTheDocument();
    });

    it('should render explanation titles', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);
      expect(screen.getByText('Alpha Explanation')).toBeInTheDocument();
      expect(screen.getByText('Beta Explanation')).toBeInTheDocument();
      expect(screen.getByText('Gamma Explanation')).toBeInTheDocument();
    });

    it('should render View links for each explanation', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);
      const viewLinks = screen.getAllByText('View');
      expect(viewLinks).toHaveLength(3);
    });
  });

  // ========================================================================
  // Sorting - Title Column Tests
  // ========================================================================

  describe('Sorting - Title Column', () => {
    it('should sort by title ascending on first click', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const titleHeader = screen.getByText('Title').closest('th')!;
      await user.click(titleHeader);

      const rows = screen.getAllByRole('row').slice(1); // Skip header row
      const firstTitle = within(rows[0]).getByText(/Explanation/);
      expect(firstTitle.textContent).toBe('Alpha Explanation');
    });

    it('should sort by title descending on second click', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const titleHeader = screen.getByText('Title').closest('th')!;
      await user.click(titleHeader);
      await user.click(titleHeader);

      const rows = screen.getAllByRole('row').slice(1);
      const firstTitle = within(rows[0]).getByText(/Explanation/);
      expect(firstTitle.textContent).toBe('Gamma Explanation');
    });

    it('should display up arrow when sorting title ascending', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const titleHeader = screen.getByText('Title').closest('th')!;
      await user.click(titleHeader);

      expect(within(titleHeader).getByTestId('arrow-up-icon')).toBeInTheDocument();
    });

    it('should display down arrow when sorting title descending', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const titleHeader = screen.getByText('Title').closest('th')!;
      await user.click(titleHeader);
      await user.click(titleHeader);

      expect(within(titleHeader).getByTestId('arrow-down-icon')).toBeInTheDocument();
    });

    it('should perform case-insensitive title sorting', async () => {
      const user = userEvent.setup();
      const mixedCaseExplanations = [
        createMockExplanation({ id: 1, explanation_title: 'Zebra', timestamp: '2024-01-01' }),
        createMockExplanation({ id: 2, explanation_title: 'apple', timestamp: '2024-01-02' }),
        createMockExplanation({ id: 3, explanation_title: 'Banana', timestamp: '2024-01-03' }),
      ];
      render(<ExplanationsTablePage explanations={mixedCaseExplanations} error={null} />);

      const titleHeader = screen.getByText('Title').closest('th')!;
      await user.click(titleHeader);

      const rows = screen.getAllByRole('row').slice(1);
      expect(within(rows[0]).getByText('apple')).toBeInTheDocument();
      expect(within(rows[1]).getByText('Banana')).toBeInTheDocument();
      expect(within(rows[2]).getByText('Zebra')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Sorting - Date Column Tests
  // ========================================================================

  describe('Sorting - Date Column', () => {
    it('should sort by date descending by default', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      // Default sort is by date descending (newest first)
      const rows = screen.getAllByRole('row').slice(1);
      const firstDate = within(rows[0]).getByText(/Formatted:/);
      expect(firstDate.textContent).toContain('2024-01-03');
    });

    it('should sort by date ascending on first click', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const dateHeader = screen.getByText('Date Created').closest('th')!;
      await user.click(dateHeader);

      const rows = screen.getAllByRole('row').slice(1);
      const firstDate = within(rows[0]).getByText(/Formatted:/);
      expect(firstDate.textContent).toContain('2024-01-01');
    });

    it('should sort by date descending on second click', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const dateHeader = screen.getByText('Date Created').closest('th')!;
      await user.click(dateHeader); // asc
      await user.click(dateHeader); // desc

      const rows = screen.getAllByRole('row').slice(1);
      const firstDate = within(rows[0]).getByText(/Formatted:/);
      expect(firstDate.textContent).toContain('2024-01-03');
    });

    it('should display down arrow when sorting date descending (default)', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const dateHeader = screen.getByText('Date Created').closest('th')!;
      expect(within(dateHeader).getByTestId('arrow-down-icon')).toBeInTheDocument();
    });

    it('should display up arrow when sorting date ascending', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const dateHeader = screen.getByText('Date Created').closest('th')!;
      await user.click(dateHeader);

      expect(within(dateHeader).getByTestId('arrow-up-icon')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Sorting - Toggle Behavior Tests
  // ========================================================================

  describe('Sorting - Toggle Behavior', () => {
    it('should toggle sort order when clicking same column', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const dateHeader = screen.getByText('Date Created').closest('th')!;

      // Initially desc, click for asc
      await user.click(dateHeader);
      expect(within(dateHeader).getByTestId('arrow-up-icon')).toBeInTheDocument();

      // Click again for desc
      await user.click(dateHeader);
      expect(within(dateHeader).getByTestId('arrow-down-icon')).toBeInTheDocument();
    });

    it('should reset to ascending when switching columns', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const dateHeader = screen.getByText('Date Created').closest('th')!;
      const titleHeader = screen.getByText('Title').closest('th')!;

      // Date starts desc, switch to title
      await user.click(titleHeader);

      // Title should be ascending
      expect(within(titleHeader).getByTestId('arrow-up-icon')).toBeInTheDocument();
    });

    it('should remove arrow from previous sort column', async () => {
      const user = userEvent.setup();
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const dateHeader = screen.getByText('Date Created').closest('th')!;
      const titleHeader = screen.getByText('Title').closest('th')!;

      // Date has arrow initially
      expect(within(dateHeader).queryByTestId('arrow-down-icon')).toBeInTheDocument();

      // Switch to title
      await user.click(titleHeader);

      // Date should not have arrow
      expect(within(dateHeader).queryByTestId('arrow-down-icon')).not.toBeInTheDocument();
      expect(within(dateHeader).queryByTestId('arrow-up-icon')).not.toBeInTheDocument();
    });
  });

  // ========================================================================
  // Content Preview Tests
  // ========================================================================

  describe('Content Preview', () => {
    it('should strip title from content using stripTitleFromContent', () => {
      const explanations = [
        createMockExplanation({
          id: 1,
          explanation_title: 'Test Title',
          content: '# Test Title\n\nActual content here',
        }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      expect(screen.getByText('Actual content here')).toBeInTheDocument();
      // The title in the content should be stripped
      const contentCells = screen.getAllByText(/Actual content/);
      expect(contentCells).toHaveLength(1);
    });

    it('should display content without markdown title', () => {
      const explanations = [
        createMockExplanation({
          id: 1,
          content: '## Heading\n\nContent without title',
        }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      expect(screen.getByText('Content without title')).toBeInTheDocument();
    });

    it('should handle content without title markup', () => {
      const explanations = [
        createMockExplanation({
          id: 1,
          content: 'Plain content without markdown title',
        }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      expect(screen.getByText('Plain content without markdown title')).toBeInTheDocument();
    });

    it('should truncate long content with CSS', () => {
      const explanations = [
        createMockExplanation({
          id: 1,
          content: '# Title\n\n' + 'Long content '.repeat(100),
        }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      const contentCell = screen.getByText(/Long content/).closest('td');
      expect(contentCell).toHaveClass('truncate', 'max-w-xs');
    });
  });

  // ========================================================================
  // Date Formatting Tests
  // ========================================================================

  describe('Date Formatting', () => {
    it('should call formatUserFriendlyDate for each explanation', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      expect(formatUserFriendlyDate).toHaveBeenCalledWith('2024-01-01T00:00:00Z');
      expect(formatUserFriendlyDate).toHaveBeenCalledWith('2024-01-02T00:00:00Z');
      expect(formatUserFriendlyDate).toHaveBeenCalledWith('2024-01-03T00:00:00Z');
    });

    it('should display formatted dates', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      expect(screen.getByText('Formatted: 2024-01-01T00:00:00Z')).toBeInTheDocument();
      expect(screen.getByText('Formatted: 2024-01-02T00:00:00Z')).toBeInTheDocument();
      expect(screen.getByText('Formatted: 2024-01-03T00:00:00Z')).toBeInTheDocument();
    });

    it('should format dateSaved when present', () => {
      const explanations = [
        createMockExplanation({
          id: 1,
          timestamp: '2024-01-01',
          dateSaved: '2024-01-05',
        }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      expect(formatUserFriendlyDate).toHaveBeenCalledWith('2024-01-05');
    });
  });

  // ========================================================================
  // Conditional Date Saved Column Tests
  // ========================================================================

  describe('Conditional Date Saved Column', () => {
    it('should show Date Saved column when data has dateSaved', () => {
      const explanations = [
        createMockExplanation({ id: 1, dateSaved: '2024-01-05' }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      expect(screen.getByText('Date Saved')).toBeInTheDocument();
    });

    it('should hide Date Saved column when data lacks dateSaved', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      expect(screen.queryByText('Date Saved')).not.toBeInTheDocument();
    });

    it('should display dateSaved value when present', () => {
      const explanations = [
        createMockExplanation({ id: 1, dateSaved: '2024-01-10' }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      expect(screen.getByText('Formatted: 2024-01-10')).toBeInTheDocument();
    });

    it('should display "-" when dateSaved is null for a row', () => {
      const explanations = [
        createMockExplanation({ id: 1, dateSaved: '2024-01-10' }),
        createMockExplanation({ id: 2, dateSaved: undefined }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      expect(screen.getByText('-')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Links Tests
  // ========================================================================

  describe('Links', () => {
    it('should generate correct link to explanation detail', () => {
      const explanations = [
        createMockExplanation({ id: 123 }),
      ];
      render(<ExplanationsTablePage explanations={explanations} error={null} />);

      const link = screen.getByText('View').closest('a');
      expect(link).toHaveAttribute('href', '/results?explanation_id=123');
    });

    it('should include explanation_id in URL for all explanations', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const links = screen.getAllByText('View').map(el => el.closest('a'));
      // Default sort is date descending, so order is 3, 2, 1
      expect(links[0]).toHaveAttribute('href', '/results?explanation_id=3');
      expect(links[1]).toHaveAttribute('href', '/results?explanation_id=2');
      expect(links[2]).toHaveAttribute('href', '/results?explanation_id=1');
    });

    it('should make View link clickable', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const link = screen.getAllByText('View')[0].closest('a');
      expect(link).toBeInTheDocument();
      expect(link?.tagName).toBe('A');
    });
  });

  // ========================================================================
  // Error State Tests
  // ========================================================================

  describe('Error State', () => {
    it('should display error message when error provided', () => {
      render(<ExplanationsTablePage explanations={[]} error="Failed to load explanations" />);

      expect(screen.getByText('Failed to load explanations')).toBeInTheDocument();
    });

    it('should style error message with red background', () => {
      render(<ExplanationsTablePage explanations={[]} error="Error occurred" />);

      const errorDiv = screen.getByText('Error occurred');
      expect(errorDiv).toHaveClass('mb-6', 'p-4', 'bg-red-100', 'text-red-700');
    });

    it('should show table even when error exists', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error="Warning message" />);

      expect(screen.getByText('Warning message')).toBeInTheDocument();
      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('should not display error div when error is null', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const errorDiv = document.querySelector('.bg-red-100');
      expect(errorDiv).not.toBeInTheDocument();
    });
  });

  // ========================================================================
  // Empty State Tests
  // ========================================================================

  describe('Empty State', () => {
    it('should show empty state message when no explanations', () => {
      render(<ExplanationsTablePage explanations={[]} error={null} />);

      expect(screen.getByText('You do not have any items in your library.')).toBeInTheDocument();
      expect(screen.getByText('Save some to get started.')).toBeInTheDocument();
    });

    it('should not show table when no explanations', () => {
      render(<ExplanationsTablePage explanations={[]} error={null} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });
  });

  // ========================================================================
  // Accessibility Tests
  // ========================================================================

  describe('Accessibility', () => {
    it('should use semantic table elements', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      expect(screen.getByRole('table')).toBeInTheDocument();
      expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
    });

    it('should have accessible column headers', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const headers = screen.getAllByRole('columnheader');
      expect(headers.length).toBeGreaterThan(0);
    });

    it('should support keyboard navigation for links', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const links = screen.getAllByText('View').map(el => el.closest('a'));
      links.forEach(link => {
        expect(link).toBeInTheDocument();
      });
    });

    it('should have cursor pointer on sortable headers', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const titleHeader = screen.getByText('Title').closest('th');
      const dateHeader = screen.getByText('Date Created').closest('th');

      expect(titleHeader).toHaveClass('cursor-pointer');
      expect(dateHeader).toHaveClass('cursor-pointer');
    });

    it('should not have cursor pointer on non-sortable headers', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const contentHeader = screen.getByText('Content').closest('th');
      expect(contentHeader).not.toHaveClass('cursor-pointer');
    });
  });

  // ========================================================================
  // Styling Tests
  // ========================================================================

  describe('Styling', () => {
    it('should apply dark mode classes', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const main = document.querySelector('main');
      expect(main?.parentElement).toHaveClass('dark:bg-gray-900');
    });

    it('should have sticky table header', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const thead = screen.getByRole('table').querySelector('thead');
      expect(thead).toHaveClass('sticky', 'top-0');
    });

    it('should apply hover effects to rows', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const row = screen.getAllByRole('row')[1]; // First data row
      expect(row).toHaveClass('hover:bg-blue-100');
    });

    it('should apply gradient to header', () => {
      render(<ExplanationsTablePage explanations={mockExplanations} error={null} />);

      const thead = screen.getByRole('table').querySelector('thead');
      expect(thead).toHaveClass('bg-gradient-to-r', 'from-blue-600');
    });
  });
});
