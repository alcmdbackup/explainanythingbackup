/**
 * Unit Tests: DiscoverSourcesPanel Component
 *
 * Tests collapsible panel, loading state, popular/similar sections,
 * add button behavior, and graceful degradation.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import DiscoverSourcesPanel from '../DiscoverSourcesPanel';
import { type DiscoveredSource } from '@/lib/services/sourceDiscovery';

const mockPopularSources: DiscoveredSource[] = [
  { source_cache_id: 1, url: 'https://wiki.example.com', domain: 'wiki.example.com', title: 'Wiki Article', favicon_url: null, frequency: 5 },
  { source_cache_id: 2, url: 'https://docs.example.com', domain: 'docs.example.com', title: 'Docs Page', favicon_url: null, frequency: 3 },
];

const mockSimilarSources: DiscoveredSource[] = [
  { source_cache_id: 3, url: 'https://blog.example.com', domain: 'blog.example.com', title: 'Blog Post', favicon_url: null, frequency: 2 },
];

// Mock server actions
jest.mock('@/actions/actions', () => ({
  getPopularSourcesByTopicAction: jest.fn(),
  getSimilarArticleSourcesAction: jest.fn(),
}));

import {
  getPopularSourcesByTopicAction,
  getSimilarArticleSourcesAction,
} from '@/actions/actions';

describe('DiscoverSourcesPanel', () => {
  const defaultProps = {
    explanationId: 42,
    topicId: 10,
    topicTitle: 'Quantum Computing',
    onAddSource: jest.fn(),
    existingUrls: [] as string[],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getPopularSourcesByTopicAction as jest.Mock).mockResolvedValue({
      data: mockPopularSources,
      error: null,
    });
    (getSimilarArticleSourcesAction as jest.Mock).mockResolvedValue({
      data: mockSimilarSources,
      error: null,
    });
  });

  // ============================================================================
  // Panel toggle
  // ============================================================================
  describe('toggle behavior', () => {
    it('renders collapsed by default', () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);
      expect(screen.getByTestId('discover-sources-panel')).toBeInTheDocument();
      expect(screen.getByTestId('discover-sources-toggle')).toBeInTheDocument();
      expect(screen.queryByTestId('popular-sources-section')).not.toBeInTheDocument();
    });

    it('expands when toggle is clicked', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('popular-sources-section')).toBeInTheDocument();
        expect(screen.getByTestId('similar-sources-section')).toBeInTheDocument();
      });
    });

    it('collapses when toggle is clicked again', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('popular-sources-section')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      expect(screen.queryByTestId('popular-sources-section')).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Data loading
  // ============================================================================
  describe('data loading', () => {
    it('fetches sources when first opened', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(getPopularSourcesByTopicAction).toHaveBeenCalledWith({
          topicId: 10,
          limit: 5,
        });
        expect(getSimilarArticleSourcesAction).toHaveBeenCalledWith({
          explanationId: 42,
          limit: 5,
        });
      });
    });

    it('does not re-fetch on subsequent opens', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(getPopularSourcesByTopicAction).toHaveBeenCalledTimes(1);
      });

      // Close and re-open
      fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      fireEvent.click(screen.getByTestId('discover-sources-toggle'));

      expect(getPopularSourcesByTopicAction).toHaveBeenCalledTimes(1);
    });

    it('skips topic query when topicId is null', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} topicId={null} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(getPopularSourcesByTopicAction).not.toHaveBeenCalled();
        expect(screen.queryByTestId('popular-sources-section')).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Source display
  // ============================================================================
  describe('source display', () => {
    it('shows popular source titles', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByText('Wiki Article')).toBeInTheDocument();
        expect(screen.getByText('Docs Page')).toBeInTheDocument();
      });
    });

    it('shows similar source titles', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByText('Blog Post')).toBeInTheDocument();
      });
    });

    it('shows section heading with topic title', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByText('Popular in Quantum Computing')).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Add button
  // ============================================================================
  describe('add button', () => {
    it('calls onAddSource when add button is clicked', async () => {
      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-add-btn-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('source-add-btn-1'));
      expect(defaultProps.onAddSource).toHaveBeenCalledWith('https://wiki.example.com');
    });

    it('disables add button for already-added sources', async () => {
      render(
        <DiscoverSourcesPanel
          {...defaultProps}
          existingUrls={['https://wiki.example.com']}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-add-btn-1')).toBeDisabled();
        expect(screen.getByTestId('source-add-btn-2')).not.toBeDisabled();
      });
    });
  });

  // ============================================================================
  // Graceful degradation
  // ============================================================================
  describe('graceful degradation', () => {
    it('shows empty message when both queries return empty', async () => {
      (getPopularSourcesByTopicAction as jest.Mock).mockResolvedValue({ data: [], error: null });
      (getSimilarArticleSourcesAction as jest.Mock).mockResolvedValue({ data: [], error: null });

      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByText('No source suggestions available yet.')).toBeInTheDocument();
      });
    });

    it('handles server action failure gracefully', async () => {
      (getPopularSourcesByTopicAction as jest.Mock).mockRejectedValue(new Error('Network error'));
      (getSimilarArticleSourcesAction as jest.Mock).mockRejectedValue(new Error('Network error'));

      render(<DiscoverSourcesPanel {...defaultProps} />);

      await act(async () => {
        fireEvent.click(screen.getByTestId('discover-sources-toggle'));
      });

      await waitFor(() => {
        expect(screen.getByText('No source suggestions available yet.')).toBeInTheDocument();
      });
    });
  });
});
