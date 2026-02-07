/**
 * Unit tests for HomeSourcesRow component - inline sources with add/remove functionality.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeSourcesRow from '../HomeSourcesRow';
import { type SourceChipType } from '@/lib/schemas/schemas';

// Mock fetchWithTracing
jest.mock('@/lib/tracing/fetchWithTracing', () => ({
  fetchWithTracing: jest.fn(),
}));

import { fetchWithTracing } from '@/lib/tracing/fetchWithTracing';

const mockFetchWithTracing = fetchWithTracing as jest.MockedFunction<typeof fetchWithTracing>;

describe('HomeSourcesRow', () => {
  const mockOnSourceAdded = jest.fn();
  const mockOnSourceRemoved = jest.fn();

  const defaultProps = {
    sources: [] as SourceChipType[],
    onSourceAdded: mockOnSourceAdded,
    onSourceRemoved: mockOnSourceRemoved,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render Sources label', () => {
      render(<HomeSourcesRow {...defaultProps} />);
      expect(screen.getByText('Sources:')).toBeInTheDocument();
    });

    it('should render Add URL button when no sources and not at limit', () => {
      render(<HomeSourcesRow {...defaultProps} />);
      expect(screen.getByTestId('home-add-source-button')).toBeInTheDocument();
    });

    it('should render source chips for provided sources', () => {
      const sources: SourceChipType[] = [
        { url: 'https://example.com', title: 'Example', domain: 'example.com', status: 'success', favicon_url: null, error_message: null },
      ];
      render(<HomeSourcesRow {...defaultProps} sources={sources} />);
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    it('should show counter when 3+ sources', () => {
      const sources: SourceChipType[] = [
        { url: 'https://a.com', title: 'A', domain: 'a.com', status: 'success', favicon_url: null, error_message: null },
        { url: 'https://b.com', title: 'B', domain: 'b.com', status: 'success', favicon_url: null, error_message: null },
        { url: 'https://c.com', title: 'C', domain: 'c.com', status: 'success', favicon_url: null, error_message: null },
      ];
      render(<HomeSourcesRow {...defaultProps} sources={sources} />);
      expect(screen.getByText('(3/5)')).toBeInTheDocument();
    });

    it('should not show Add URL button when at limit', () => {
      const sources: SourceChipType[] = Array.from({ length: 5 }, (_, i) => ({
        url: `https://site${i}.com`,
        title: `Site ${i}`,
        domain: `site${i}.com`,
        status: 'success' as const,
        favicon_url: null,
        error_message: null,
      }));
      render(<HomeSourcesRow {...defaultProps} sources={sources} />);
      expect(screen.queryByTestId('home-add-source-button')).not.toBeInTheDocument();
    });
  });

  describe('Adding Sources', () => {
    it('should show inline input when Add URL is clicked', async () => {
      const user = userEvent.setup();
      render(<HomeSourcesRow {...defaultProps} />);

      await user.click(screen.getByTestId('home-add-source-button'));
      expect(screen.getByTestId('home-source-url-input')).toBeInTheDocument();
    });

    it('should hide input and show Add URL button when Cancel is clicked', async () => {
      const user = userEvent.setup();
      render(<HomeSourcesRow {...defaultProps} />);

      await user.click(screen.getByTestId('home-add-source-button'));
      await user.click(screen.getByText('Cancel'));

      expect(screen.queryByTestId('home-source-url-input')).not.toBeInTheDocument();
      expect(screen.getByTestId('home-add-source-button')).toBeInTheDocument();
    });

    it('should show error for invalid URL', async () => {
      const user = userEvent.setup();
      render(<HomeSourcesRow {...defaultProps} />);

      await user.click(screen.getByTestId('home-add-source-button'));
      await user.type(screen.getByTestId('home-source-url-input'), 'not-a-url');
      await user.click(screen.getByTestId('home-source-add-button'));

      expect(screen.getByText('Please enter a valid URL')).toBeInTheDocument();
    });

    it('should call onSourceAdded with loading chip and then fetched data', async () => {
      const user = userEvent.setup();
      const mockResponse = {
        json: jest.fn().mockResolvedValue({
          success: true,
          data: {
            url: 'https://example.com',
            title: 'Example Site',
            domain: 'example.com',
            status: 'success',
            favicon_url: 'https://example.com/favicon.ico',
            error_message: null,
          },
        }),
      };
      mockFetchWithTracing.mockResolvedValue(mockResponse as unknown as Response);

      render(<HomeSourcesRow {...defaultProps} />);

      await user.click(screen.getByTestId('home-add-source-button'));
      await user.type(screen.getByTestId('home-source-url-input'), 'https://example.com');
      await user.click(screen.getByTestId('home-source-add-button'));

      // Should be called with loading chip first
      expect(mockOnSourceAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://example.com',
          status: 'loading',
        })
      );

      // Then with success data
      await waitFor(() => {
        expect(mockOnSourceAdded).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://example.com',
            title: 'Example Site',
            status: 'success',
          })
        );
      });
    });
  });

  describe('Removing Sources', () => {
    it('should call onSourceRemoved when remove button is clicked', async () => {
      const user = userEvent.setup();
      const sources: SourceChipType[] = [
        { url: 'https://example.com', title: 'Example', domain: 'example.com', status: 'success', favicon_url: null, error_message: null },
      ];
      render(<HomeSourcesRow {...defaultProps} sources={sources} />);

      const removeButton = screen.getByRole('button', { name: /remove source/i });
      await user.click(removeButton);

      expect(mockOnSourceRemoved).toHaveBeenCalledWith(0);
    });
  });

  describe('Disabled State', () => {
    it('should disable Add URL button when disabled prop is true', () => {
      render(<HomeSourcesRow {...defaultProps} disabled />);
      expect(screen.getByTestId('home-add-source-button')).toBeDisabled();
    });
  });
});
