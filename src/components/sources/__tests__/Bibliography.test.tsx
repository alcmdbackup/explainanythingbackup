/**
 * Unit Tests: Bibliography Component
 *
 * Tests the Bibliography component rendering:
 * - Renders list of sources with indices
 * - Shows title, domain, and external link
 * - Returns null when no sources
 * - Handles missing optional fields
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Bibliography from '../Bibliography';

describe('Bibliography', () => {
  const mockSources = [
    {
      index: 1,
      title: 'First Source Article',
      domain: 'source1.com',
      url: 'https://source1.com/article',
      favicon_url: 'https://source1.com/favicon.ico'
    },
    {
      index: 2,
      title: 'Second Source Article',
      domain: 'source2.org',
      url: 'https://source2.org/page',
      favicon_url: null
    }
  ];

  it('renders sources section with heading', () => {
    render(<Bibliography sources={mockSources} />);

    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('renders all source entries', () => {
    render(<Bibliography sources={mockSources} />);

    expect(screen.getByText('First Source Article')).toBeInTheDocument();
    expect(screen.getByText('Second Source Article')).toBeInTheDocument();
  });

  it('displays source indices', () => {
    render(<Bibliography sources={mockSources} />);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders domain for each source', () => {
    render(<Bibliography sources={mockSources} />);

    expect(screen.getByText(/source1.com/)).toBeInTheDocument();
    expect(screen.getByText(/source2.org/)).toBeInTheDocument();
  });

  it('renders external links with correct href', () => {
    render(<Bibliography sources={mockSources} />);

    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', 'https://source1.com/article');
    expect(links[1]).toHaveAttribute('href', 'https://source2.org/page');
  });

  it('opens links in new tab', () => {
    render(<Bibliography sources={mockSources} />);

    const links = screen.getAllByRole('link');
    links.forEach(link => {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('returns null when sources array is empty', () => {
    const { container } = render(<Bibliography sources={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when sources is undefined', () => {
    // @ts-expect-error Testing undefined case
    const { container } = render(<Bibliography sources={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('handles source without title gracefully', () => {
    const sourceNoTitle = [{
      index: 1,
      title: '',
      domain: 'notitle.com',
      url: 'https://notitle.com/page',
      favicon_url: null
    }];

    render(<Bibliography sources={sourceNoTitle} />);
    // Should fall back to domain or show empty
    expect(screen.getByText('notitle.com')).toBeInTheDocument();
  });

  it('creates anchor IDs for scroll targeting', () => {
    render(<Bibliography sources={mockSources} />);

    const firstEntry = document.getElementById('source-1');
    const secondEntry = document.getElementById('source-2');

    expect(firstEntry).toBeInTheDocument();
    expect(secondEntry).toBeInTheDocument();
  });
});
