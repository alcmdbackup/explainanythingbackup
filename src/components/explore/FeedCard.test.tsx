/**
 * Unit tests for FeedCard component.
 * Tests rendering, metrics display, link behavior, and accessibility.
 */
import { render, screen } from '@testing-library/react';
import FeedCard from './FeedCard';

// Mock Next.js Link component
jest.mock('next/link', () => {
  return function MockLink({ children, href, ...props }: { children: React.ReactNode; href: string }) {
    return <a href={href} {...props}>{children}</a>;
  };
});

// Mock ShareButton to verify props
jest.mock('@/components/ShareButton', () => {
  return function MockShareButton({ url, variant }: { url: string; variant: string }) {
    return <button data-testid="share-button" data-url={url} data-variant={variant}>Share</button>;
  };
});

const mockExplanation = {
  id: 123,
  explanation_title: 'Test Explanation Title',
  content: '# Heading\n\nThis is the content of the explanation with more details.',
  summary_teaser: 'This is a preview teaser for the explanation.',
  timestamp: '2024-03-20T10:30:00Z',
};

const mockMetrics = {
  total_views: 1500,
  total_saves: 42,
};

// Store original location
const originalLocation = window.location;

describe('FeedCard', () => {
  beforeAll(() => {
    // Delete and redefine location for mocking
    // @ts-expect-error - deleting window.location for testing
    delete window.location;
    // @ts-expect-error - assigning partial Location for testing
    window.location = { origin: 'https://example.com' };
  });

  afterAll(() => {
    // Restore original location
    // @ts-expect-error - restoring original location
    window.location = originalLocation;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render the title', () => {
      render(<FeedCard explanation={mockExplanation} />);
      expect(screen.getByText('Test Explanation Title')).toBeInTheDocument();
    });

    it('should render the timestamp formatted', () => {
      render(<FeedCard explanation={mockExplanation} />);
      // Mar 20, 2024 format
      expect(screen.getByText('Mar 20, 2024')).toBeInTheDocument();
    });

    it('should prefer summary_teaser for preview', () => {
      render(<FeedCard explanation={mockExplanation} />);
      expect(screen.getByText('This is a preview teaser for the explanation.')).toBeInTheDocument();
    });

    it('should strip markdown title from content when no teaser', () => {
      const explanationWithoutTeaser = {
        ...mockExplanation,
        summary_teaser: null,
      };

      render(<FeedCard explanation={explanationWithoutTeaser} />);
      expect(screen.getByText(/This is the content of the explanation/)).toBeInTheDocument();
    });

    it('should have data-testid attribute', () => {
      render(<FeedCard explanation={mockExplanation} />);
      expect(screen.getByTestId('feed-card')).toBeInTheDocument();
    });
  });

  describe('link behavior', () => {
    it('should have correct link href', () => {
      render(<FeedCard explanation={mockExplanation} />);
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/results?explanation_id=123');
    });
  });

  describe('metrics display', () => {
    it('should display view count', () => {
      render(<FeedCard explanation={mockExplanation} metrics={mockMetrics} />);
      // 1500 should display as "1.5k"
      expect(screen.getByText('1.5k')).toBeInTheDocument();
    });

    it('should display saves count', () => {
      render(<FeedCard explanation={mockExplanation} metrics={mockMetrics} />);
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should format large numbers with k suffix', () => {
      const largeMetrics = {
        total_views: 2000,
        total_saves: 1000,
      };
      render(<FeedCard explanation={mockExplanation} metrics={largeMetrics} />);
      expect(screen.getByText('2k')).toBeInTheDocument();
      expect(screen.getByText('1k')).toBeInTheDocument();
    });

    it('should format numbers without decimal when even thousands', () => {
      const evenMetrics = {
        total_views: 1000,
        total_saves: 3000,
      };
      render(<FeedCard explanation={mockExplanation} metrics={evenMetrics} />);
      expect(screen.getByText('1k')).toBeInTheDocument();
      expect(screen.getByText('3k')).toBeInTheDocument();
    });

    it('should default to 0 when metrics not provided', () => {
      render(<FeedCard explanation={mockExplanation} />);
      // Should have two "0" values for views and saves
      const zeros = screen.getAllByText('0');
      expect(zeros).toHaveLength(2);
    });
  });

  describe('ShareButton integration', () => {
    it('should pass correct URL path to ShareButton', () => {
      render(<FeedCard explanation={mockExplanation} />);
      const shareButton = screen.getByTestId('share-button');
      const url = shareButton.getAttribute('data-url');
      // URL should contain the correct path regardless of origin
      expect(url).toContain('/results?explanation_id=123');
    });

    it('should pass text variant to ShareButton', () => {
      render(<FeedCard explanation={mockExplanation} />);
      const shareButton = screen.getByTestId('share-button');
      expect(shareButton).toHaveAttribute('data-variant', 'text');
    });
  });

  describe('animation', () => {
    it('should set --card-index CSS variable from index prop', () => {
      const { container } = render(
        <FeedCard explanation={mockExplanation} index={5} />
      );

      const article = container.querySelector('article');
      expect(article).toHaveStyle('--card-index: 5');
    });

    it('should default index to 0', () => {
      const { container } = render(
        <FeedCard explanation={mockExplanation} />
      );

      const article = container.querySelector('article');
      expect(article).toHaveStyle('--card-index: 0');
    });

    it('should have feed-card class', () => {
      const { container } = render(
        <FeedCard explanation={mockExplanation} />
      );

      const article = container.querySelector('article');
      expect(article).toHaveClass('feed-card');
    });
  });

  describe('edge cases', () => {
    it('should handle invalid timestamp gracefully', () => {
      const explanationWithBadTimestamp = {
        ...mockExplanation,
        timestamp: 'invalid-date',
      };

      render(<FeedCard explanation={explanationWithBadTimestamp} />);
      // Should render empty string for timestamp
      expect(screen.getByTestId('feed-card')).toBeInTheDocument();
    });

    it('should handle empty content', () => {
      const explanationWithEmptyContent = {
        ...mockExplanation,
        content: '',
        summary_teaser: null,
      };

      render(<FeedCard explanation={explanationWithEmptyContent} />);
      expect(screen.getByTestId('feed-card')).toBeInTheDocument();
    });

    it('should handle missing metrics fields', () => {
      const partialMetrics = {
        total_views: 100,
        total_saves: undefined as unknown as number,
      };

      render(<FeedCard explanation={mockExplanation} metrics={partialMetrics} />);
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });
  });

  describe('savedDate prop', () => {
    it('renders without savedDate (existing behavior unchanged)', () => {
      render(<FeedCard explanation={mockExplanation} />);
      expect(screen.queryByTestId('saved-date')).not.toBeInTheDocument();
    });

    it('renders savedDate on right side of engagement bar', () => {
      render(<FeedCard explanation={mockExplanation} savedDate="2026-01-19T12:00:00Z" />);
      expect(screen.getByTestId('saved-date')).toBeInTheDocument();
    });

    it('displays "Saved just now" for very recent timestamps', () => {
      const justNow = new Date().toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={justNow} />);
      expect(screen.getByText('Saved just now')).toBeInTheDocument();
    });

    it('displays "Saved 1 minute ago" for 1-minute-old timestamps', () => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={oneMinuteAgo} />);
      expect(screen.getByText('Saved 1 minute ago')).toBeInTheDocument();
    });

    it('displays "Saved X minutes ago" for 2-59 minute old timestamps', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={fiveMinutesAgo} />);
      expect(screen.getByText('Saved 5 minutes ago')).toBeInTheDocument();
    });

    it('displays "Saved 1 hour ago" for 1-hour-old timestamps', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={oneHourAgo} />);
      expect(screen.getByText('Saved 1 hour ago')).toBeInTheDocument();
    });

    it('displays "Saved X hours ago" for 2-23 hour old timestamps', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={threeHoursAgo} />);
      expect(screen.getByText('Saved 3 hours ago')).toBeInTheDocument();
    });

    it('displays "Saved yesterday" for 1-day-old timestamps', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={yesterday} />);
      expect(screen.getByText('Saved yesterday')).toBeInTheDocument();
    });

    it('displays "Saved X days ago" for 2-6 day old timestamps', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={threeDaysAgo} />);
      expect(screen.getByText('Saved 3 days ago')).toBeInTheDocument();
    });

    it('displays "Saved X weeks ago" for 7-29 day old timestamps', () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={twoWeeksAgo} />);
      expect(screen.getByText('Saved 2 weeks ago')).toBeInTheDocument();
    });

    it('displays "Saved X months ago" for 30-364 day old timestamps', () => {
      const twoMonthsAgo = new Date(Date.now() - 60 * 86400000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={twoMonthsAgo} />);
      expect(screen.getByText('Saved 2 months ago')).toBeInTheDocument();
    });

    it('displays "Saved X years ago" for 365+ day old timestamps', () => {
      const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={twoYearsAgo} />);
      expect(screen.getByText('Saved 2 years ago')).toBeInTheDocument();
    });

    it('handles invalid date gracefully (returns empty string)', () => {
      render(<FeedCard explanation={mockExplanation} savedDate="invalid-date" />);
      const savedDateEl = screen.getByTestId('saved-date');
      expect(savedDateEl.textContent).toBe('');
    });

    it('uses singular form for 1 week', () => {
      const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={oneWeekAgo} />);
      expect(screen.getByText('Saved 1 week ago')).toBeInTheDocument();
    });

    it('uses singular form for 1 month', () => {
      const oneMonthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={oneMonthAgo} />);
      expect(screen.getByText('Saved 1 month ago')).toBeInTheDocument();
    });

    it('uses singular form for 1 year', () => {
      const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString();
      render(<FeedCard explanation={mockExplanation} savedDate={oneYearAgo} />);
      expect(screen.getByText('Saved 1 year ago')).toBeInTheDocument();
    });

    it('handles empty string gracefully', () => {
      render(<FeedCard explanation={mockExplanation} savedDate="" />);
      // Empty string is falsy, so savedDate span should not render
      expect(screen.queryByTestId('saved-date')).not.toBeInTheDocument();
    });

    it('handles non-ISO date formats gracefully', () => {
      render(<FeedCard explanation={mockExplanation} savedDate="January 1, 2026" />);
      // Non-ISO format should still parse via Date constructor
      expect(screen.getByTestId('saved-date')).toBeInTheDocument();
    });
  });
});
