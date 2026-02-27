// Tests for VariantContentSection: expand/collapse toggle for long content previews.

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { VariantContentSection } from './VariantContentSection';

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

const SHORT_CONTENT = 'This is a short piece of content.';
const LONG_CONTENT = 'A'.repeat(600);

describe('VariantContentSection', () => {
  it('renders short content without expand button', () => {
    render(<VariantContentSection content={SHORT_CONTENT} />);
    expect(screen.getByText(SHORT_CONTENT)).toBeInTheDocument();
    expect(screen.queryByText('Expand')).not.toBeInTheDocument();
    expect(screen.queryByText('Collapse')).not.toBeInTheDocument();
  });

  it('truncates long content (>500 chars) and shows "Expand" button', () => {
    render(<VariantContentSection content={LONG_CONTENT} />);
    // Should show truncated content with "..."
    expect(screen.getByText('A'.repeat(500) + '...')).toBeInTheDocument();
    expect(screen.getByText('Expand')).toBeInTheDocument();
  });

  it('clicking "Expand" shows full content', () => {
    render(<VariantContentSection content={LONG_CONTENT} />);
    fireEvent.click(screen.getByText('Expand'));
    expect(screen.getByText(LONG_CONTENT)).toBeInTheDocument();
    expect(screen.getByText('Collapse')).toBeInTheDocument();
    expect(screen.queryByText('Expand')).not.toBeInTheDocument();
  });

  it('clicking "Collapse" truncates again', () => {
    render(<VariantContentSection content={LONG_CONTENT} />);
    fireEvent.click(screen.getByText('Expand'));
    expect(screen.getByText(LONG_CONTENT)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Collapse'));
    expect(screen.getByText('A'.repeat(500) + '...')).toBeInTheDocument();
    expect(screen.getByText('Expand')).toBeInTheDocument();
  });

  it('has data-testid="variant-content-section"', () => {
    render(<VariantContentSection content={SHORT_CONTENT} />);
    expect(screen.getByTestId('variant-content-section')).toBeInTheDocument();
  });

  it('shows "Content" heading', () => {
    render(<VariantContentSection content={SHORT_CONTENT} />);
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('renders exactly 500 chars content without expand button', () => {
    const exact500 = 'B'.repeat(500);
    render(<VariantContentSection content={exact500} />);
    expect(screen.getByText(exact500)).toBeInTheDocument();
    expect(screen.queryByText('Expand')).not.toBeInTheDocument();
  });
});
