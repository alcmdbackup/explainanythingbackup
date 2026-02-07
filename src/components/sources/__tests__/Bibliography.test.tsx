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

  // ============================================================================
  // Citation count badges
  // ============================================================================
  describe('citation count badges', () => {
    const sourcesWithIds = [
      { index: 1, title: 'Source A', domain: 'a.com', url: 'https://a.com', source_cache_id: 10, favicon_url: null },
      { index: 2, title: 'Source B', domain: 'b.com', url: 'https://b.com', source_cache_id: 20, favicon_url: null },
    ];

    it('renders citation badge when citationCounts are provided', () => {
      const counts = [
        { source_cache_id: 10, total_citations: 5 },
        { source_cache_id: 20, total_citations: 3 },
      ];

      render(<Bibliography sources={sourcesWithIds} citationCounts={counts} />);

      expect(screen.getByTestId('citation-badge-10')).toBeInTheDocument();
      expect(screen.getByText('Cited in 5 articles')).toBeInTheDocument();
      expect(screen.getByText('Cited in 3 articles')).toBeInTheDocument();
    });

    it('does not render badge when citation count is 1', () => {
      const counts = [{ source_cache_id: 10, total_citations: 1 }];

      render(<Bibliography sources={sourcesWithIds} citationCounts={counts} />);

      expect(screen.queryByTestId('citation-badge-10')).not.toBeInTheDocument();
    });

    it('does not render badges when citationCounts is not provided', () => {
      render(<Bibliography sources={sourcesWithIds} />);

      expect(screen.queryByTestId('citation-badge-10')).not.toBeInTheDocument();
      expect(screen.queryByTestId('citation-badge-20')).not.toBeInTheDocument();
    });

    it('badge links to source profile page', () => {
      const counts = [{ source_cache_id: 10, total_citations: 5 }];

      render(<Bibliography sources={sourcesWithIds} citationCounts={counts} />);

      const badge = screen.getByTestId('citation-badge-10');
      expect(badge).toHaveAttribute('href', '/sources/10');
    });

    it('handles sources without source_cache_id gracefully', () => {
      const sourcesNoId = [
        { index: 1, title: 'No ID', domain: 'noid.com', url: 'https://noid.com', favicon_url: null },
      ];
      const counts = [{ source_cache_id: 99, total_citations: 5 }];

      render(<Bibliography sources={sourcesNoId} citationCounts={counts} />);

      expect(screen.queryByText(/Cited in/)).not.toBeInTheDocument();
    });
  });
});
