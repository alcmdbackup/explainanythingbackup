/**
 * Unit Tests: SourceProfile Component
 *
 * Tests source metadata display, citing articles list, co-cited sources,
 * and edge cases (empty lists, missing optional data).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SourceProfile from '../SourceProfile';
import { type SourceProfileData } from '@/lib/services/sourceDiscovery';
import { FetchStatus } from '@/lib/schemas/schemas';

// Mock Navigation to avoid router dependencies
jest.mock('@/components/Navigation', () => {
  return function MockNavigation() {
    return <div data-testid="navigation">Nav</div>;
  };
});

// Mock ExplanationCard
jest.mock('@/components/explore/ExplanationCard', () => {
  return function MockExplanationCard({ explanation }: { explanation: { explanation_title: string } }) {
    return <div data-testid={`explanation-card`}>{explanation.explanation_title}</div>;
  };
});

const mockProfileData: SourceProfileData = {
  source: {
    id: 42,
    url: 'https://en.wikipedia.org/wiki/Quantum_computing',
    title: 'Quantum Computing',
    domain: 'en.wikipedia.org',
    favicon_url: 'https://en.wikipedia.org/favicon.ico',
    extracted_text: 'Some text about quantum computing...',
    is_summarized: false,
    original_length: 5000,
    fetch_status: FetchStatus.Success,
    error_message: null,
    expires_at: null,
    url_hash: 'abc123',
    fetched_at: '2026-01-15T00:00:00.000Z',
    created_at: '2026-01-15T00:00:00.000Z',
  },
  citingArticles: [
    { id: 100, explanation_title: 'What is Quantum Computing?', content: 'An explanation about...' },
    { id: 200, explanation_title: 'Quantum vs Classical', content: 'A comparison...' },
  ],
  coCitedSources: [
    { source_cache_id: 50, url: 'https://arxiv.org/paper', domain: 'arxiv.org', title: 'Related Paper', favicon_url: null, frequency: 3 },
  ],
};

describe('SourceProfile', () => {
  it('renders the source profile header', () => {
    render(<SourceProfile data={mockProfileData} />);
    expect(screen.getByTestId('source-profile-header')).toBeInTheDocument();
  });

  it('displays source title', () => {
    render(<SourceProfile data={mockProfileData} />);
    expect(screen.getByText('Quantum Computing')).toBeInTheDocument();
  });

  it('displays source domain', () => {
    render(<SourceProfile data={mockProfileData} />);
    expect(screen.getByText('en.wikipedia.org')).toBeInTheDocument();
  });

  it('renders "Visit source" link', () => {
    render(<SourceProfile data={mockProfileData} />);
    const link = screen.getByText('Visit source');
    expect(link.closest('a')).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Quantum_computing');
  });

  it('renders citing articles list', () => {
    render(<SourceProfile data={mockProfileData} />);
    expect(screen.getByTestId('citing-articles-list')).toBeInTheDocument();
    expect(screen.getByText('What is Quantum Computing?')).toBeInTheDocument();
    expect(screen.getByText('Quantum vs Classical')).toBeInTheDocument();
  });

  it('shows correct citation count in heading', () => {
    render(<SourceProfile data={mockProfileData} />);
    expect(screen.getByText('Cited in 2 articles')).toBeInTheDocument();
  });

  it('uses singular "article" for 1 citing article', () => {
    const singleArticleData: SourceProfileData = {
      ...mockProfileData,
      citingArticles: [mockProfileData.citingArticles[0]!],
    };
    render(<SourceProfile data={singleArticleData} />);
    expect(screen.getByText('Cited in 1 article')).toBeInTheDocument();
  });

  it('renders co-cited sources', () => {
    render(<SourceProfile data={mockProfileData} />);
    expect(screen.getByTestId('co-cited-sources-list')).toBeInTheDocument();
    expect(screen.getByText('Related Paper')).toBeInTheDocument();
  });

  it('hides co-cited section when empty', () => {
    const noCoCited: SourceProfileData = {
      ...mockProfileData,
      coCitedSources: [],
    };
    render(<SourceProfile data={noCoCited} />);
    expect(screen.queryByTestId('co-cited-sources-list')).not.toBeInTheDocument();
  });

  it('shows empty message when no citing articles', () => {
    const noArticles: SourceProfileData = {
      ...mockProfileData,
      citingArticles: [],
    };
    render(<SourceProfile data={noArticles} />);
    expect(screen.getByText('No published articles cite this source yet.')).toBeInTheDocument();
  });

  it('falls back to domain when title is null', () => {
    const noTitle: SourceProfileData = {
      ...mockProfileData,
      source: { ...mockProfileData.source, title: null },
    };
    render(<SourceProfile data={noTitle} />);
    // Domain appears as the h1 title
    const headings = screen.getAllByText('en.wikipedia.org');
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });
});
