/**
 * Unit tests for SourceCombobox — Radix Popover open/close, discovery fetch,
 * text filtering, URL add, keyboard navigation, ARIA roles, and disabled states.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SourceCombobox from '../SourceCombobox';
import { type DiscoveredSource } from '@/lib/services/sourceDiscovery';

// Mock server actions
jest.mock('@/actions/actions', () => ({
  getPopularSourcesByTopicAction: jest.fn(),
  getSimilarArticleSourcesAction: jest.fn(),
}));

// Mock useSourceSubmit
const mockSubmitUrl = jest.fn();
const mockClearError = jest.fn();
let mockHookState = {
  isSubmitting: false,
  error: null as string | null,
};

jest.mock('@/hooks/useSourceSubmit', () => {
  return jest.fn(() => ({
    submitUrl: mockSubmitUrl,
    isSubmitting: mockHookState.isSubmitting,
    error: mockHookState.error,
    clearError: mockClearError,
  }));
});

import {
  getPopularSourcesByTopicAction,
  getSimilarArticleSourcesAction,
} from '@/actions/actions';

const mockDiscoveredSources: DiscoveredSource[] = [
  { source_cache_id: 1, url: 'https://wiki.example.com', domain: 'wiki.example.com', title: 'Wiki Article', favicon_url: null, frequency: 5 },
  { source_cache_id: 2, url: 'https://docs.example.com', domain: 'docs.example.com', title: 'Docs Page', favicon_url: 'https://docs.example.com/fav.ico', frequency: 3 },
  { source_cache_id: 3, url: 'https://blog.example.com', domain: 'blog.example.com', title: 'Blog Post', favicon_url: null, frequency: 1 },
];

describe('SourceCombobox', () => {
  const defaultProps = {
    explanationId: 42,
    topicId: 10 as number | null,
    onSourceAdded: jest.fn(),
    existingUrls: [] as string[],
    maxSources: 5,
    currentCount: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHookState = { isSubmitting: false, error: null };

    (getPopularSourcesByTopicAction as jest.Mock).mockResolvedValue({
      data: [mockDiscoveredSources[0], mockDiscoveredSources[1]],
      error: null,
    });
    (getSimilarArticleSourcesAction as jest.Mock).mockResolvedValue({
      data: [mockDiscoveredSources[2]],
      error: null,
    });
  });

  // ============================================================================
  // Rendering
  // ============================================================================
  describe('rendering', () => {
    it('renders combobox input', () => {
      render(<SourceCombobox {...defaultProps} />);
      expect(screen.getByTestId('source-combobox-input')).toBeInTheDocument();
    });

    it('shows at-limit message when at max', () => {
      render(<SourceCombobox {...defaultProps} currentCount={5} maxSources={5} />);
      expect(screen.getByText('Maximum 5 sources reached')).toBeInTheDocument();
      expect(screen.queryByTestId('source-combobox-input')).not.toBeInTheDocument();
    });

    it('has correct placeholder text', () => {
      render(<SourceCombobox {...defaultProps} />);
      expect(screen.getByPlaceholderText('Search or paste URL...')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // ARIA roles
  // ============================================================================
  describe('ARIA roles', () => {
    it('input has role=combobox', () => {
      render(<SourceCombobox {...defaultProps} />);
      const input = screen.getByTestId('source-combobox-input');
      expect(input).toHaveAttribute('role', 'combobox');
    });

    it('input has aria-expanded=false when closed', () => {
      render(<SourceCombobox {...defaultProps} />);
      const input = screen.getByTestId('source-combobox-input');
      expect(input).toHaveAttribute('aria-expanded', 'false');
    });

    it('input has aria-controls pointing to listbox', () => {
      render(<SourceCombobox {...defaultProps} />);
      const input = screen.getByTestId('source-combobox-input');
      expect(input).toHaveAttribute('aria-controls', 'source-combobox-listbox');
    });

    it('input has aria-autocomplete=list', () => {
      render(<SourceCombobox {...defaultProps} />);
      const input = screen.getByTestId('source-combobox-input');
      expect(input).toHaveAttribute('aria-autocomplete', 'list');
    });
  });

  // ============================================================================
  // Popover open/close
  // ============================================================================
  describe('popover open/close', () => {
    it('opens dropdown on focus', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-listbox')).toBeInTheDocument();
      });
    });

    it('opens dropdown on text input', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.change(screen.getByTestId('source-combobox-input'), {
          target: { value: 'a' },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-listbox')).toBeInTheDocument();
      });
    });

    it('closes dropdown on Escape', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-listbox')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.keyDown(screen.getByTestId('source-combobox-input'), { key: 'Escape' });
      });

      await waitFor(() => {
        expect(screen.queryByTestId('source-combobox-listbox')).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Discovery fetch
  // ============================================================================
  describe('discovery fetch', () => {
    it('fetches sources on mount when explanationId is provided', async () => {
      render(<SourceCombobox {...defaultProps} />);

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

    it('skips popular query when topicId is null', async () => {
      render(<SourceCombobox {...defaultProps} topicId={null} />);

      await waitFor(() => {
        expect(getPopularSourcesByTopicAction).not.toHaveBeenCalled();
        expect(getSimilarArticleSourcesAction).toHaveBeenCalled();
      });
    });

    it('does not fetch when explanationId is undefined', () => {
      render(<SourceCombobox {...defaultProps} explanationId={undefined} />);
      expect(getPopularSourcesByTopicAction).not.toHaveBeenCalled();
      expect(getSimilarArticleSourcesAction).not.toHaveBeenCalled();
    });

    it('re-fetches when explanationId changes', async () => {
      const { rerender } = render(<SourceCombobox {...defaultProps} />);

      await waitFor(() => {
        expect(getSimilarArticleSourcesAction).toHaveBeenCalledTimes(1);
      });

      rerender(<SourceCombobox {...defaultProps} explanationId={99} />);

      await waitFor(() => {
        expect(getSimilarArticleSourcesAction).toHaveBeenCalledTimes(2);
      });
    });

    it('displays discovered sources in dropdown', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-item-1')).toBeInTheDocument();
        expect(screen.getByTestId('source-combobox-item-2')).toBeInTheDocument();
        expect(screen.getByTestId('source-combobox-item-3')).toBeInTheDocument();
      });
    });

    it('deduplicates sources with same source_cache_id', async () => {
      (getPopularSourcesByTopicAction as jest.Mock).mockResolvedValue({
        data: [mockDiscoveredSources[0]],
        error: null,
      });
      // Return same source in similar sources
      (getSimilarArticleSourcesAction as jest.Mock).mockResolvedValue({
        data: [{ ...mockDiscoveredSources[0] }],
        error: null,
      });

      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      await waitFor(() => {
        // Should only appear once
        const items = screen.getAllByTestId('source-combobox-item-1');
        expect(items).toHaveLength(1);
      });
    });
  });

  // ============================================================================
  // Hint and "Add as URL" row
  // ============================================================================
  describe('hint and add rows', () => {
    it('shows paste hint when input is empty', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-hint')).toBeInTheDocument();
        expect(screen.getByText('Paste a URL to add')).toBeInTheDocument();
      });
    });

    it('shows "Add as URL" when text is typed', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.change(screen.getByTestId('source-combobox-input'), {
          target: { value: 'example' },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-add-url')).toBeInTheDocument();
        expect(screen.getByText('Add as URL: "example"')).toBeInTheDocument();
      });
    });

    it('shows "Add [url]" when URL detected', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.change(screen.getByTestId('source-combobox-input'), {
          target: { value: 'https://example.com/article' },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-add-url')).toBeInTheDocument();
        expect(screen.getByText('Add https://example.com/article')).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Text filtering
  // ============================================================================
  describe('text filtering', () => {
    it('filters discovered sources by title', async () => {
      render(<SourceCombobox {...defaultProps} />);

      // Wait for discovery to load
      await waitFor(() => {
        expect(getSimilarArticleSourcesAction).toHaveBeenCalled();
      });

      await act(async () => {
        fireEvent.change(screen.getByTestId('source-combobox-input'), {
          target: { value: 'wiki' },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-item-1')).toBeInTheDocument();
        expect(screen.queryByTestId('source-combobox-item-2')).not.toBeInTheDocument();
        expect(screen.queryByTestId('source-combobox-item-3')).not.toBeInTheDocument();
      });
    });

    it('filters by domain', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await waitFor(() => {
        expect(getSimilarArticleSourcesAction).toHaveBeenCalled();
      });

      await act(async () => {
        fireEvent.change(screen.getByTestId('source-combobox-input'), {
          target: { value: 'docs' },
        });
      });

      await waitFor(() => {
        expect(screen.queryByTestId('source-combobox-item-1')).not.toBeInTheDocument();
        expect(screen.getByTestId('source-combobox-item-2')).toBeInTheDocument();
      });
    });

    it('hides sources when URL is detected (only shows add row)', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await waitFor(() => {
        expect(getSimilarArticleSourcesAction).toHaveBeenCalled();
      });

      await act(async () => {
        fireEvent.change(screen.getByTestId('source-combobox-input'), {
          target: { value: 'https://new-url.com' },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-add-url')).toBeInTheDocument();
        expect(screen.queryByTestId('source-combobox-item-1')).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Adding URL via combobox
  // ============================================================================
  describe('add URL action', () => {
    it('calls submitUrl when "Add as URL" is clicked', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.change(screen.getByTestId('source-combobox-input'), {
          target: { value: 'https://example.com' },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-add-url')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('source-combobox-add-url'));
      });

      expect(mockSubmitUrl).toHaveBeenCalledWith('https://example.com');
    });
  });

  // ============================================================================
  // Adding discovered source
  // ============================================================================
  describe('add discovered source', () => {
    it('calls onSourceAdded with SourceChipType when discovered source is clicked', async () => {
      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-item-1')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('source-combobox-item-1'));
      });

      expect(defaultProps.onSourceAdded).toHaveBeenCalledWith({
        url: 'https://wiki.example.com',
        title: 'Wiki Article',
        favicon_url: null,
        domain: 'wiki.example.com',
        status: 'success',
        error_message: null,
        source_cache_id: 1,
      });
    });

    it('disables already-added sources', async () => {
      render(
        <SourceCombobox
          {...defaultProps}
          existingUrls={['https://wiki.example.com']}
        />
      );

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      await waitFor(() => {
        const item = screen.getByTestId('source-combobox-item-1');
        expect(item).toHaveAttribute('aria-disabled', 'true');
      });
    });

    it('does not add already-added source on click', async () => {
      render(
        <SourceCombobox
          {...defaultProps}
          existingUrls={['https://wiki.example.com']}
        />
      );

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-item-1')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('source-combobox-item-1'));
      });

      expect(defaultProps.onSourceAdded).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Keyboard navigation
  // ============================================================================
  describe('keyboard navigation', () => {
    it('ArrowDown moves active index forward', async () => {
      render(<SourceCombobox {...defaultProps} />);

      const input = screen.getByTestId('source-combobox-input');

      await act(async () => {
        fireEvent.focus(input);
      });

      // Wait for sources to load and dropdown to appear
      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-listbox')).toBeInTheDocument();
      });

      // Type to get "Add as URL" row
      await act(async () => {
        fireEvent.change(input, { target: { value: 'test' } });
      });

      // ArrowDown to select first item
      await act(async () => {
        fireEvent.keyDown(input, { key: 'ArrowDown' });
      });

      const addRow = screen.getByTestId('source-combobox-add-url');
      expect(addRow).toHaveAttribute('aria-selected', 'true');
    });

    it('Enter selects the active item', async () => {
      render(<SourceCombobox {...defaultProps} />);

      const input = screen.getByTestId('source-combobox-input');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'https://example.com' } });
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-add-url')).toBeInTheDocument();
      });

      // ArrowDown then Enter
      await act(async () => {
        fireEvent.keyDown(input, { key: 'ArrowDown' });
      });

      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });

      expect(mockSubmitUrl).toHaveBeenCalledWith('https://example.com');
    });

    it('Enter with no active index submits URL when text is present', async () => {
      render(<SourceCombobox {...defaultProps} />);

      const input = screen.getByTestId('source-combobox-input');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'https://example.com' } });
      });

      await act(async () => {
        fireEvent.keyDown(input, { key: 'Enter' });
      });

      expect(mockSubmitUrl).toHaveBeenCalledWith('https://example.com');
    });
  });

  // ============================================================================
  // Disabled state
  // ============================================================================
  describe('disabled state', () => {
    it('disables input when disabled prop is true', () => {
      render(<SourceCombobox {...defaultProps} disabled />);
      expect(screen.getByTestId('source-combobox-input')).toBeDisabled();
    });

    it('disables input when isSubmitting', () => {
      mockHookState.isSubmitting = true;
      render(<SourceCombobox {...defaultProps} />);
      expect(screen.getByTestId('source-combobox-input')).toBeDisabled();
    });
  });

  // ============================================================================
  // Error display
  // ============================================================================
  describe('error display', () => {
    it('shows error from useSourceSubmit hook', () => {
      mockHookState.error = 'Invalid URL';
      render(<SourceCombobox {...defaultProps} />);
      expect(screen.getByTestId('source-combobox-error')).toHaveTextContent('Invalid URL');
    });
  });

  // ============================================================================
  // Graceful degradation
  // ============================================================================
  describe('graceful degradation', () => {
    it('works without discovery when actions fail', async () => {
      (getPopularSourcesByTopicAction as jest.Mock).mockRejectedValue(new Error('fail'));
      (getSimilarArticleSourcesAction as jest.Mock).mockRejectedValue(new Error('fail'));

      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.focus(screen.getByTestId('source-combobox-input'));
      });

      // Should still show hint — just no discovered sources
      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-hint')).toBeInTheDocument();
      });
    });

    it('URL add works without discovery data', async () => {
      (getPopularSourcesByTopicAction as jest.Mock).mockResolvedValue({ data: [], error: null });
      (getSimilarArticleSourcesAction as jest.Mock).mockResolvedValue({ data: [], error: null });

      render(<SourceCombobox {...defaultProps} />);

      await act(async () => {
        fireEvent.change(screen.getByTestId('source-combobox-input'), {
          target: { value: 'https://example.com' },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('source-combobox-add-url')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('source-combobox-add-url'));
      });

      expect(mockSubmitUrl).toHaveBeenCalledWith('https://example.com');
    });
  });
});
