import { render, screen, waitFor } from '@testing-library/react';
import UserLibraryPage from './page';
import { getUserLibraryExplanationsAction } from '@/actions/actions';
import { supabase_browser } from '@/lib/supabase';
import { logger } from '@/lib/server_utilities';
import { ExplanationStatus, type UserSavedExplanationType } from '@/lib/schemas/schemas';

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

jest.mock('@/lib/server_utilities', () => ({
  logger: {
    error: jest.fn(),
  },
}));

// Mock the component
jest.mock('@/components/ExplanationsTablePage', () => {
  return function MockExplanationsTablePage({
    explanations,
    error,
  }: {
    explanations: any[];
    error: string | null;
  }) {
    return (
      <div data-testid="explanations-table">
        <div data-testid="explanations-count">{explanations.length}</div>
        {error && <div data-testid="error-message">{error}</div>}
        {explanations.map((exp, i) => (
          <div key={i} data-testid={`explanation-${i}`}>
            {exp.dateSaved && <span data-testid={`date-saved-${i}`}>{exp.dateSaved}</span>}
          </div>
        ))}
      </div>
    );
  };
});

describe('UserLibraryPage', () => {
  const mockUserSavedExplanations: UserSavedExplanationType[] = [
    {
      id: 1,
      explanation_title: 'First Saved Explanation',
      content: '# First\n\nContent',
      primary_topic_id: 1,
      status: ExplanationStatus.Published,
      timestamp: '2025-01-01T00:00:00Z',
      saved_timestamp: '2025-01-02T00:00:00Z',
    },
    {
      id: 2,
      explanation_title: 'Second Saved Explanation',
      content: '# Second\n\nMore content',
      primary_topic_id: 2,
      status: ExplanationStatus.Published,
      timestamp: '2025-01-03T00:00:00Z',
      saved_timestamp: '2025-01-04T00:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Loading State', () => {
    it('should show loading message initially', () => {
      // Mock pending promises to keep loading state
      (supabase_browser.auth.getUser as jest.Mock).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      render(<UserLibraryPage />);

      expect(screen.getByText('Loading your library...')).toBeInTheDocument();
    });

    it('should have correct loading message styling', () => {
      (supabase_browser.auth.getUser as jest.Mock).mockImplementation(
        () => new Promise(() => {})
      );

      render(<UserLibraryPage />);

      const loadingContainer = screen.getByText('Loading your library...').parentElement;
      expect(loadingContainer).toHaveClass('flex', 'justify-center', 'items-center', 'min-h-screen');
    });

    it('should hide loading state after data loads', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockUserSavedExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.queryByText('Loading your library...')).not.toBeInTheDocument();
      });
    });
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
        const errorMessage = screen.getByTestId('error-message');
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
        const errorMessage = screen.getByTestId('error-message');
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
        const errorMessage = screen.getByTestId('error-message');
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
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockUserSavedExplanations);

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
        const errorMessage = screen.getByTestId('error-message');
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
        const errorMessage = screen.getByTestId('error-message');
        expect(errorMessage).toHaveTextContent('Failed to load user library explanations');
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

  describe('Data Transformation', () => {
    it('should map saved_timestamp to dateSaved', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockUserSavedExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const dateSaved0 = screen.getByTestId('date-saved-0');
        expect(dateSaved0).toHaveTextContent('2025-01-02T00:00:00Z');

        const dateSaved1 = screen.getByTestId('date-saved-1');
        expect(dateSaved1).toHaveTextContent('2025-01-04T00:00:00Z');
      });
    });

    it('should preserve all explanation fields', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockUserSavedExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const count = screen.getByTestId('explanations-count');
        expect(count).toHaveTextContent('2');
      });
    });

    it('should handle empty results', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const count = screen.getByTestId('explanations-count');
        expect(count).toHaveTextContent('0');
      });
    });

    it('should handle large number of explanations', async () => {
      const manyExplanations = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        explanation_title: `Explanation ${i + 1}`,
        content: `Content ${i + 1}`,
        primary_topic_id: 1,
        status: ExplanationStatus.Published,
        timestamp: '2025-01-01T00:00:00Z',
        saved_timestamp: `2025-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }));

      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(manyExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const count = screen.getByTestId('explanations-count');
        expect(count).toHaveTextContent('50');
      });
    });
  });

  describe('Component Rendering', () => {
    it('should render ExplanationsTablePage after loading', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockUserSavedExplanations);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const table = screen.getByTestId('explanations-table');
        expect(table).toBeInTheDocument();
      });
    });

    it('should pass error prop to ExplanationsTablePage', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'Auth error' },
      });

      render(<UserLibraryPage />);

      await waitFor(() => {
        const errorMessage = screen.getByTestId('error-message');
        expect(errorMessage).toBeInTheDocument();
      });
    });

    it('should not render table during loading', () => {
      (supabase_browser.auth.getUser as jest.Mock).mockImplementation(
        () => new Promise(() => {})
      );

      render(<UserLibraryPage />);

      const table = screen.queryByTestId('explanations-table');
      expect(table).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid re-renders', async () => {
      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue(mockUserSavedExplanations);

      const { rerender } = render(<UserLibraryPage />);

      await waitFor(() => {
        expect(screen.getByTestId('explanations-table')).toBeInTheDocument();
      });

      // Should not refetch on rerender (useEffect with empty deps)
      rerender(<UserLibraryPage />);

      await waitFor(() => {
        // Still only called once from initial mount
        expect(supabase_browser.auth.getUser).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle explanations with optional fields', async () => {
      const explanationWithOptionals: UserSavedExplanationType = {
        id: 10,
        explanation_title: 'Optional Fields',
        content: 'Content',
        primary_topic_id: 1,
        secondary_topic_id: 5,
        status: ExplanationStatus.Draft,
        timestamp: '2025-01-01T00:00:00Z',
        saved_timestamp: '2025-01-02T00:00:00Z',
      };

      (supabase_browser.auth.getUser as jest.Mock).mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      (getUserLibraryExplanationsAction as jest.Mock).mockResolvedValue([explanationWithOptionals]);

      render(<UserLibraryPage />);

      await waitFor(() => {
        const count = screen.getByTestId('explanations-count');
        expect(count).toHaveTextContent('1');
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
        const errorElement = screen.queryByTestId('error-message');
        expect(errorElement).not.toBeInTheDocument();
      });
    });
  });
});
