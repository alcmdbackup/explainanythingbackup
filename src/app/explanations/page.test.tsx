import { render, screen } from '@testing-library/react';
import ExplanationsPage from './page';
import { getRecentExplanations } from '@/lib/services/explanations';
import { ExplanationStatus, type ExplanationFullDbType } from '@/lib/schemas/schemas';

// Mock the service layer
jest.mock('@/lib/services/explanations', () => ({
  getRecentExplanations: jest.fn(),
}));

// Mock the component
jest.mock('@/components/ExplanationsTablePage', () => {
  return function MockExplanationsTablePage({
    explanations,
    error
  }: {
    explanations: any[];
    error: string | null;
  }) {
    return (
      <div data-testid="explanations-table">
        <div data-testid="explanations-count">{explanations.length}</div>
        {error && <div data-testid="error-message">{error}</div>}
      </div>
    );
  };
});

// Helper to create mock searchParams
const createMockSearchParams = (params: { sort?: string; t?: string } = {}): Promise<{ sort?: string; t?: string }> => {
  return Promise.resolve(params);
};

describe('ExplanationsPage', () => {
  const mockExplanations: ExplanationFullDbType[] = [
    {
      id: 1,
      explanation_title: 'First Explanation',
      content: '# First Explanation\n\nContent here',
      primary_topic_id: 1,
      status: ExplanationStatus.Published,
      timestamp: '2025-01-01T00:00:00Z',
    },
    {
      id: 2,
      explanation_title: 'Second Explanation',
      content: '# Second Explanation\n\nMore content',
      primary_topic_id: 2,
      status: ExplanationStatus.Published,
      timestamp: '2025-01-03T00:00:00Z',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Server-Side Data Fetching', () => {
    it('should fetch recent explanations on load', async () => {
      (getRecentExplanations as jest.Mock).mockResolvedValue(mockExplanations);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      expect(getRecentExplanations).toHaveBeenCalledTimes(1);
      expect(getRecentExplanations).toHaveBeenCalledWith(20, 0, { sort: 'new', period: 'week' });
    });

    it('should pass fetched data to ExplanationsTablePage', async () => {
      (getRecentExplanations as jest.Mock).mockResolvedValue(mockExplanations);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const table = screen.getByTestId('explanations-table');
      expect(table).toBeInTheDocument();

      const count = screen.getByTestId('explanations-count');
      expect(count).toHaveTextContent('2');
    });

    it('should pass empty array when no explanations exist', async () => {
      (getRecentExplanations as jest.Mock).mockResolvedValue([]);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const count = screen.getByTestId('explanations-count');
      expect(count).toHaveTextContent('0');
    });

    it('should handle fetch with multiple explanations', async () => {
      const tenExplanations = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        explanation_title: `Explanation ${i + 1}`,
        content: `Content ${i + 1}`,
        primary_topic_id: 1,
        status: ExplanationStatus.Published,
        timestamp: '2025-01-01T00:00:00Z',
      }));

      (getRecentExplanations as jest.Mock).mockResolvedValue(tenExplanations);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const count = screen.getByTestId('explanations-count');
      expect(count).toHaveTextContent('10');
    });

    it('should pass sort and period from searchParams', async () => {
      (getRecentExplanations as jest.Mock).mockResolvedValue(mockExplanations);

      const PageComponent = await ExplanationsPage({
        searchParams: createMockSearchParams({ sort: 'top', t: 'month' })
      });
      render(PageComponent);

      expect(getRecentExplanations).toHaveBeenCalledWith(20, 0, { sort: 'top', period: 'month' });
    });
  });

  describe('Error Handling', () => {
    it('should pass error to ExplanationsTablePage when fetch fails with Error', async () => {
      const errorMessage = 'Database connection failed';
      (getRecentExplanations as jest.Mock).mockRejectedValue(new Error(errorMessage));

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const errorElement = screen.getByTestId('error-message');
      expect(errorElement).toHaveTextContent(errorMessage);
    });

    it('should pass generic error message when fetch fails with non-Error', async () => {
      (getRecentExplanations as jest.Mock).mockRejectedValue('String error');

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const errorElement = screen.getByTestId('error-message');
      expect(errorElement).toHaveTextContent('Failed to load recent explanations');
    });

    it('should pass empty array when fetch fails', async () => {
      (getRecentExplanations as jest.Mock).mockRejectedValue(new Error('Failed'));

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const count = screen.getByTestId('explanations-count');
      expect(count).toHaveTextContent('0');
    });

    it('should handle null error when fetch succeeds', async () => {
      (getRecentExplanations as jest.Mock).mockResolvedValue(mockExplanations);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const errorElement = screen.queryByTestId('error-message');
      expect(errorElement).not.toBeInTheDocument();
    });
  });

  describe('Component Rendering', () => {
    it('should render ExplanationsTablePage component', async () => {
      (getRecentExplanations as jest.Mock).mockResolvedValue(mockExplanations);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const table = screen.getByTestId('explanations-table');
      expect(table).toBeInTheDocument();
    });

    it('should pass both explanations and error props to ExplanationsTablePage', async () => {
      (getRecentExplanations as jest.Mock).mockRejectedValue(new Error('Test error'));

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      // Verify component is rendered
      const table = screen.getByTestId('explanations-table');
      expect(table).toBeInTheDocument();

      // Verify both props are handled
      const count = screen.getByTestId('explanations-count');
      expect(count).toHaveTextContent('0');

      const errorElement = screen.getByTestId('error-message');
      expect(errorElement).toBeInTheDocument();
    });
  });

  describe('Data Structure', () => {
    it('should pass ExplanationFullDbType array to component', async () => {
      const explanationWithAllFields: ExplanationFullDbType = {
        id: 123,
        explanation_title: 'Complete Explanation',
        content: 'Full content here',
        primary_topic_id: 5,
        secondary_topic_id: 10,
        status: ExplanationStatus.Draft,
        timestamp: '2025-11-06T12:00:00Z',
      };

      (getRecentExplanations as jest.Mock).mockResolvedValue([explanationWithAllFields]);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const count = screen.getByTestId('explanations-count');
      expect(count).toHaveTextContent('1');
    });

    it('should handle explanations without optional fields', async () => {
      const minimalExplanation: ExplanationFullDbType = {
        id: 1,
        explanation_title: 'Minimal',
        content: 'Content',
        primary_topic_id: 1,
        status: ExplanationStatus.Published,
        timestamp: '2025-01-01T00:00:00Z',
      };

      (getRecentExplanations as jest.Mock).mockResolvedValue([minimalExplanation]);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const table = screen.getByTestId('explanations-table');
      expect(table).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle timeout errors', async () => {
      (getRecentExplanations as jest.Mock).mockRejectedValue(
        new Error('Request timeout')
      );

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const errorElement = screen.getByTestId('error-message');
      expect(errorElement).toHaveTextContent('Request timeout');
    });

    it('should handle network errors', async () => {
      (getRecentExplanations as jest.Mock).mockRejectedValue(
        new Error('Network error: Failed to fetch')
      );

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const errorElement = screen.getByTestId('error-message');
      expect(errorElement).toHaveTextContent('Network error');
    });

    it('should handle undefined or null rejections', async () => {
      (getRecentExplanations as jest.Mock).mockRejectedValue(null);

      const PageComponent = await ExplanationsPage({ searchParams: createMockSearchParams() });
      render(PageComponent);

      const errorElement = screen.getByTestId('error-message');
      expect(errorElement).toHaveTextContent('Failed to load recent explanations');
    });
  });
});
