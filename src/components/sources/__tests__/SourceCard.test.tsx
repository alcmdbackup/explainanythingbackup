/**
 * Unit Tests: SourceCard Component
 *
 * Tests rendering of source metadata, citation count badge, favicon,
 * and edge cases (null title, null favicon).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SourceCard from '../SourceCard';

describe('SourceCard', () => {
  const defaultProps = {
    sourceCacheId: 42,
    domain: 'en.wikipedia.org',
    title: 'Quantum Computing',
    faviconUrl: 'https://en.wikipedia.org/favicon.ico',
    totalCitations: 47,
    uniqueExplanations: 31,
  };

  it('renders with data-testid containing source cache id', () => {
    render(<SourceCard {...defaultProps} />);
    expect(screen.getByTestId('source-card-42')).toBeInTheDocument();
  });

  it('displays the source title', () => {
    render(<SourceCard {...defaultProps} />);
    expect(screen.getByText('Quantum Computing')).toBeInTheDocument();
  });

  it('displays the domain', () => {
    render(<SourceCard {...defaultProps} />);
    expect(screen.getByText('en.wikipedia.org')).toBeInTheDocument();
  });

  it('displays the citation count', () => {
    render(<SourceCard {...defaultProps} />);
    expect(screen.getByText('47')).toBeInTheDocument();
    expect(screen.getByText('citations')).toBeInTheDocument();
  });

  it('displays the unique explanations count', () => {
    render(<SourceCard {...defaultProps} />);
    expect(screen.getByText('31 articles')).toBeInTheDocument();
  });

  it('uses singular "article" for 1 explanation', () => {
    render(<SourceCard {...defaultProps} uniqueExplanations={1} />);
    expect(screen.getByText('1 article')).toBeInTheDocument();
  });

  it('renders favicon image when faviconUrl is provided', () => {
    const { container } = render(<SourceCard {...defaultProps} />);
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://en.wikipedia.org/favicon.ico');
  });

  it('renders domain initial when faviconUrl is null', () => {
    const { container } = render(<SourceCard {...defaultProps} faviconUrl={null} />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('e')).toBeInTheDocument();
  });

  it('uses domain as title when title is null', () => {
    render(<SourceCard {...defaultProps} title={null} />);
    // Domain appears both as title fallback and as the subtitle
    const domainElements = screen.getAllByText('en.wikipedia.org');
    expect(domainElements.length).toBeGreaterThanOrEqual(2);
  });

  it('applies animation delay based on index', () => {
    render(<SourceCard {...defaultProps} index={3} />);
    const card = screen.getByTestId('source-card-42');
    expect(card).toHaveStyle({ animationDelay: '180ms' });
  });
});
