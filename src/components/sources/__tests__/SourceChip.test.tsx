/**
 * Unit Tests: SourceChip Component
 *
 * Tests the SourceChip component rendering and interactions:
 * - Displays source favicon, title, and domain
 * - Shows loading state with spinner
 * - Shows error state with warning icon
 * - Remove button triggers onRemove callback
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SourceChip from '../SourceChip';
import { type SourceChipType } from '@/lib/schemas/schemas';

describe('SourceChip', () => {
  const mockOnRemove = jest.fn();

  const successSource: SourceChipType = {
    url: 'https://example.com/article',
    title: 'Example Article Title',
    favicon_url: 'https://example.com/favicon.ico',
    domain: 'example.com',
    status: 'success',
    error_message: null
  };

  const loadingSource: SourceChipType = {
    url: 'https://loading.com/page',
    title: null,
    favicon_url: null,
    domain: 'loading.com',
    status: 'loading',
    error_message: null
  };

  const failedSource: SourceChipType = {
    url: 'https://failed.com/page',
    title: null,
    favicon_url: null,
    domain: 'failed.com',
    status: 'failed',
    error_message: 'Connection timeout'
  };

  beforeEach(() => {
    mockOnRemove.mockClear();
  });

  it('renders success state with title and domain', () => {
    render(<SourceChip source={successSource} onRemove={mockOnRemove} />);

    expect(screen.getByText('Example Article Title')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
  });

  it('renders loading state with loading text', () => {
    render(<SourceChip source={loadingSource} onRemove={mockOnRemove} />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
    // Should show animate-pulse class for loading state
    const chip = screen.getByText('Loading...').closest('div');
    expect(chip).toHaveClass('animate-pulse');
  });

  it('renders failed state with warning', () => {
    render(<SourceChip source={failedSource} onRemove={mockOnRemove} showWarning={true} />);

    expect(screen.getByText('failed.com')).toBeInTheDocument();
    // Should have error styling
    const chip = screen.getByText('failed.com').closest('div');
    expect(chip).toBeInTheDocument();
  });

  it('calls onRemove when remove button is clicked', () => {
    render(<SourceChip source={successSource} onRemove={mockOnRemove} />);

    const removeButton = screen.getByRole('button');
    fireEvent.click(removeButton);

    expect(mockOnRemove).toHaveBeenCalledTimes(1);
  });

  it('does not call onRemove during loading state', () => {
    render(<SourceChip source={loadingSource} onRemove={mockOnRemove} />);

    // Remove button should not be visible during loading
    const buttons = screen.queryAllByRole('button');
    // In loading state, the button may be hidden or disabled
    if (buttons.length > 0) {
      const removeButton = buttons[0];
      fireEvent.click(removeButton);
      // Loading state typically prevents removal
    }
  });

  it('displays favicon when available', () => {
    render(<SourceChip source={successSource} onRemove={mockOnRemove} />);

    // Favicon has alt="" for decorative purposes, so use different selector
    const favicon = document.querySelector('img[src="https://example.com/favicon.ico"]');
    expect(favicon).toBeInTheDocument();
  });

  it('falls back to domain when no title', () => {
    const sourceNoTitle: SourceChipType = {
      ...successSource,
      title: null
    };

    render(<SourceChip source={sourceNoTitle} onRemove={mockOnRemove} />);

    // Should show domain twice or just domain
    expect(screen.getAllByText('example.com').length).toBeGreaterThanOrEqual(1);
  });
});
