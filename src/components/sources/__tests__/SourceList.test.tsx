/**
 * Baseline unit tests for SourceList component — chip rendering,
 * add/remove callbacks, count indicator, empty state, and input visibility.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SourceList from '../SourceList';
import { type SourceChipType } from '@/lib/schemas/schemas';

// Mock child components to isolate SourceList logic
jest.mock('../SourceChip', () => {
  return function MockSourceChip({
    source,
    onRemove,
  }: {
    source: SourceChipType;
    onRemove: () => void;
  }) {
    return (
      <div data-testid={`source-chip-${source.url}`}>
        <span>{source.title || source.domain}</span>
        <button data-testid={`remove-${source.url}`} onClick={onRemove}>
          Remove
        </button>
      </div>
    );
  };
});

// Mock SourceCombobox (lazy-loaded)
jest.mock('../SourceCombobox', () => {
  return function MockSourceCombobox({
    onSourceAdded,
    disabled,
    explanationId,
  }: {
    onSourceAdded: (s: SourceChipType) => void;
    disabled?: boolean;
    explanationId?: number;
  }) {
    return (
      <div data-testid="source-combobox">
        <span data-testid="combobox-explanation-id">{explanationId}</span>
        <button
          data-testid="mock-combobox-add"
          disabled={disabled}
          onClick={() =>
            onSourceAdded({
              url: 'https://discovered.example.com',
              domain: 'discovered.example.com',
              title: 'Discovered Source',
              status: 'success',
              favicon_url: null,
              error_message: null,
            })
          }
        >
          Add Discovered
        </button>
      </div>
    );
  };
});

jest.mock('../SourceInput', () => {
  return function MockSourceInput({
    onSourceAdded,
    disabled,
    maxSources,
    currentCount,
  }: {
    onSourceAdded: (s: SourceChipType) => void;
    disabled?: boolean;
    maxSources?: number;
    currentCount?: number;
  }) {
    return (
      <div data-testid="source-input">
        <span data-testid="source-input-count">{currentCount}/{maxSources}</span>
        <button
          data-testid="mock-source-add"
          disabled={disabled}
          onClick={() =>
            onSourceAdded({
              url: 'https://new.example.com',
              domain: 'new.example.com',
              title: 'New Source',
              status: 'success',
              favicon_url: null,
              error_message: null,
            })
          }
        >
          Add
        </button>
      </div>
    );
  };
});

const mockSources: SourceChipType[] = [
  { url: 'https://a.com', domain: 'a.com', title: 'Source A', status: 'success', favicon_url: null, error_message: null },
  { url: 'https://b.com', domain: 'b.com', title: 'Source B', status: 'success', favicon_url: null, error_message: null },
];

describe('SourceList', () => {
  const defaultProps = {
    sources: mockSources,
    onSourceAdded: jest.fn(),
    onSourceRemoved: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Source chips rendering
  // ============================================================================
  describe('chip rendering', () => {
    it('renders a chip for each source', () => {
      render(<SourceList {...defaultProps} />);
      expect(screen.getByTestId('source-chip-https://a.com')).toBeInTheDocument();
      expect(screen.getByTestId('source-chip-https://b.com')).toBeInTheDocument();
    });

    it('renders no chips when sources is empty', () => {
      render(<SourceList {...defaultProps} sources={[]} />);
      expect(screen.queryByTestId('source-chip-https://a.com')).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Source count indicator
  // ============================================================================
  describe('count indicator', () => {
    it('shows count when sources exist', () => {
      render(<SourceList {...defaultProps} maxSources={5} />);
      expect(screen.getByText('2/5 sources')).toBeInTheDocument();
    });

    it('does not show count when sources is empty', () => {
      render(<SourceList {...defaultProps} sources={[]} />);
      expect(screen.queryByText(/sources$/)).not.toBeInTheDocument();
    });

    it('shows failed message when some sources failed', () => {
      const sourcesWithFailed: SourceChipType[] = [
        ...mockSources,
        { url: 'https://c.com', domain: 'c.com', title: null, status: 'failed', favicon_url: null, error_message: 'err' },
      ];
      render(<SourceList {...defaultProps} sources={sourcesWithFailed} />);
      expect(screen.getByTestId('sources-failed-message')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Input visibility
  // ============================================================================
  describe('input visibility', () => {
    it('shows input by default (showInput=true)', () => {
      render(<SourceList {...defaultProps} />);
      expect(screen.getByTestId('source-input')).toBeInTheDocument();
    });

    it('hides input when showInput=false', () => {
      render(<SourceList {...defaultProps} showInput={false} />);
      expect(screen.queryByTestId('source-input')).not.toBeInTheDocument();
    });

    it('shows empty state when no sources and showInput=false', () => {
      render(<SourceList {...defaultProps} sources={[]} showInput={false} />);
      expect(screen.getByText('No sources added')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Callbacks
  // ============================================================================
  describe('callbacks', () => {
    it('calls onSourceAdded when source is added via input', () => {
      render(<SourceList {...defaultProps} />);
      fireEvent.click(screen.getByTestId('mock-source-add'));
      expect(defaultProps.onSourceAdded).toHaveBeenCalled();
    });

    it('calls onSourceRemoved when remove is clicked', () => {
      render(<SourceList {...defaultProps} />);
      fireEvent.click(screen.getByTestId('remove-https://a.com'));
      expect(defaultProps.onSourceRemoved).toHaveBeenCalledWith(0);
    });
  });

  // ============================================================================
  // Disabled state
  // ============================================================================
  describe('disabled', () => {
    it('passes disabled to SourceInput', () => {
      render(<SourceList {...defaultProps} disabled />);
      expect(screen.getByTestId('mock-source-add')).toBeDisabled();
    });
  });

  // ============================================================================
  // Custom className
  // ============================================================================
  describe('className', () => {
    it('applies custom className', () => {
      const { container } = render(
        <SourceList {...defaultProps} className="custom-class" />
      );
      expect(container.firstChild).toHaveClass('custom-class');
    });
  });

  // ============================================================================
  // Conditional SourceCombobox / SourceInput rendering
  // ============================================================================
  describe('conditional rendering', () => {
    it('renders SourceInput when no explanationId', () => {
      render(<SourceList {...defaultProps} />);
      expect(screen.getByTestId('source-input')).toBeInTheDocument();
      expect(screen.queryByTestId('source-combobox')).not.toBeInTheDocument();
    });

    it('renders SourceCombobox when explanationId is provided', async () => {
      render(<SourceList {...defaultProps} explanationId={42} />);
      // SourceCombobox is lazy-loaded — wait for it
      await screen.findByTestId('source-combobox');
      expect(screen.getByTestId('source-combobox')).toBeInTheDocument();
    });

    it('passes explanationId to SourceCombobox', async () => {
      render(<SourceList {...defaultProps} explanationId={99} />);
      const idEl = await screen.findByTestId('combobox-explanation-id');
      expect(idEl).toHaveTextContent('99');
    });

    it('calls onSourceAdded from SourceCombobox', async () => {
      render(<SourceList {...defaultProps} explanationId={42} />);
      const addBtn = await screen.findByTestId('mock-combobox-add');
      fireEvent.click(addBtn);
      expect(defaultProps.onSourceAdded).toHaveBeenCalled();
    });
  });
});
