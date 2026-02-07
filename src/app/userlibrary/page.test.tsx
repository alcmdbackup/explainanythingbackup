/**
 * Unit tests for UserLibraryPage component.
 * Tests FeedCard-based layout, authentication, and data fetching.
 */
import { render, screen, waitFor } from '@testing-library/react';
import UserLibraryPage from './page';
import { getUserLibraryExplanationsAction } from '@/actions/actions';
import { supabase_browser } from '@/lib/supabase';
import { logger } from '@/lib/client_utilities';
import { ExplanationStatus, type UserSavedExplanationWithMetrics } from '@/lib/schemas/schemas';

// Mock the dependencies
jest.mock('@/actions/actions', () => ({
  getUserLibraryExplanationsAction: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase_browser: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

jest.mock('@/lib/client_utilities', () => ({
  logger: {
    error: jest.fn(),
  },
}));

// Mock Next.js Link component
jest.mock('next/link', () => {
  return function MockLink({ children, href, ...props }: { children: React.ReactNode; href: string }) {
    return <a href={href} {...props}>{children}</a>;
  };
});

// Mock Navigation component
jest.mock('@/components/Navigation', () => {
  return function MockNavigation() {
    return <nav data-testid="navigation">Navigation</nav>;
  };
});

// Mock ShareButton
jest.mock('@/components/ShareButton', () => {
  return function MockShareButton() {
    return <button data-testid="share-button">Share</button>;
  };
});

describe('UserLibraryPage', () => {
  const mockExplanations: UserSavedExplanationWithMetrics[] = [
    {
      id: 1,
      explanation_title: 'First Saved Explanation',
      content: '# First\n\nContent',
      summary_teaser: 'First teaser',
      primary_topic_id: 1,
      status: ExplanationStatus.Published,
      timestamp: '2025-01-01T00:00:00Z',
      saved_timestamp: '2025-01-02T00:00:00Z',
      total_views: 100,
      total_saves: 10,
    },
    {
      id: 2,
      explanation_title: 'Second Saved Explanation',
      content: '# Second\n\nMore content',
      summary_teaser: 'Second teaser',
      primary_topic_id: 2,
      status: ExplanationStatus.Published,
      timestamp: '2025-01-03T00:00:00Z',
      saved_timestamp: '2025-01-04T00:00:00Z',
      total_views: 200,
      total_saves: 20,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication Flow', () => {
    it('should fetch user on mount', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(supabase_browser.auth.getUser).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle auth error', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'Auth failed' },
      });

      render(<UserLibraryPage />);

      await waitFor(() => {
        const errorMessage = screen.getByTestId('library-error');
        expect(errorMessage).toHaveTextContent('Could not get user information. Please log in.');
      });
    });

    it('should handle missing user data', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: null,
        error: null,
      });

      render(<UserLibraryPage />);

      await waitFor(() => {
        const errorMessage = screen.getByTestId('library-error');
        expect(errorMessage).toHaveTextContent('Could not get user information. Please log in.');
      });
    });

    it('should handle missing user id', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: {} },
        error: null,
      });

      render(<UserLibraryPage />);

      await waitFor(() => {
        const errorMessage = screen.getByTestId('library-error');
        expect(errorMessage).toHaveTextContent('Could not get user information. Please log in.');
      });
    });

    it('should log auth errors', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'Auth failed' },
      });

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to load user library explanations:',
          { error: 'Could not get user information. Please log in.' }
        );
      });
    });
  });

  describe('Data Fetching', () => {
    it('should fetch library after auth succeeds', async () => {
      const userId = 'test-user-456';
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: userId } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(getUserLibraryExplanationsAction).toHaveBeenCalledTimes(1);
        expect(getUserLibraryExplanationsAction).toHaveBeenCalledWith(userId);
      });
    });

    it('should not fetch library if auth fails', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'Auth failed' },
      });

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(getUserLibraryExplanationsAction).not.toHaveBeenCalled();
      });
    });

    it('should handle fetch errors', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockRejectedValue(
        new Error('Database error')
      );

      render(<UserLibraryPage />);

      await waitFor(() => {
        const errorMessage = screen.getByTestId('library-error');
        expect(errorMessage).toHaveTextContent('Database error');
      });
    });

    it('should handle non-Error fetch failures', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockRejectedValue('String error');

      render(<UserLibraryPage />);

      await waitFor(() => {
        const errorMessage = screen.getByTestId('library-error');
        expect(errorMessage).toHaveTextContent('Failed to load library');
      });
    });

    it('should log fetch errors', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      const errorMsg = 'Network timeout';
      (getUserLibraryExplanationsAction as jest.Mock).mockRejectedValue(new Error(errorMsg));

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          'Failed to load user library explanations:',
          { error: errorMsg }
        );
      });
    });
  });

  describe('FeedCard Rendering', () => {
    it('should render FeedCard components for saved explanations', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const cards = screen.getAllByTestId('feed-card');
        expect(cards).toHaveLength(mockExplanations.length);
      });
    });

    it('should pass savedDate prop to FeedCard', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const savedDates = screen.getAllByTestId('saved-date');
        expect(savedDates).toHaveLength(mockExplanations.length);
      });
    });

    it('should display explanation titles', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('First Saved Explanation')).toBeInTheDocument();
        expect(screen.getByText('Second Saved Explanation')).toBeInTheDocument();
      });
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no saved explanations', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.getByTestId('library-empty-state')).toBeInTheDocument();
      });
    });

    it('should display empty state message', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('Nothing saved yet')).toBeInTheDocument();
        expect(screen.getByText('Save explanations you want to revisit.')).toBeInTheDocument();
      });
    });
  });

  describe('Error State', () => {
    it('should show error message when fetch fails', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockRejectedValue(new Error('Network error'));

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.getByTestId('library-error')).toBeInTheDocument();
      });
    });
  });

  describe('Page Layout', () => {
    it('should render page title', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.getByText('My Library')).toBeInTheDocument();
      });
    });

    it('should render navigation', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.getByTestId('navigation')).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid re-renders', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockExplanations);

      const { rerender } = render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.getAllByTestId('feed-card')).toHaveLength(2);
      });

      // Should not refetch on rerender (useEffect with empty deps)
      rerender(<UserLibraryPage />);

      await waitFor(() => {
        // Still only called once from initial mount
        expect(supabase_browser.auth.getUser).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle explanations with optional fields', async () => {
      const explanationWithOptionals: UserSavedExplanationWithMetrics = {
        id: 10,
        explanation_title: 'Optional Fields',
        content: 'Content',
        primary_topic_id: 1,
        secondary_topic_id: 5,
        status: ExplanationStatus.Draft,
        timestamp: '2025-01-01T00:00:00Z',
        saved_timestamp: '2025-01-02T00:00:00Z',
        total_views: 50,
        total_saves: 5,
      };

      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([explanationWithOptionals]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const cards = screen.getAllByTestId('feed-card');
        expect(cards).toHaveLength(1);
      });
    });

    it('should handle null error on success', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const errorElement = screen.queryByTestId('library-error');
        expect(errorElement).not.toBeInTheDocument();
      });
    });
  });
});
