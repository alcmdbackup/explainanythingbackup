// Tests for VariantMatchHistory: loading skeleton, match table, empty state, and win/loss summary.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { VariantMatchHistory } from './VariantMatchHistory';
import type { VariantMatchEntry } from '@evolution/services/variantDetailActions';

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

jest.mock('@evolution/lib/utils/evolutionUrls', () => ({
  buildVariantDetailUrl: (id: string) => `/admin/evolution/variants/${id}`,
}));

const mockGetMatchHistory = jest.fn();

jest.mock('@evolution/services/variantDetailActions', () => ({
  getVariantMatchHistoryAction: (...args: unknown[]) => mockGetMatchHistory(...args),
}));

const sampleMatches: VariantMatchEntry[] = [
  { opponentId: 'opp-aaa-111', opponentElo: 1350, won: true, confidence: 0.85 },
  { opponentId: 'opp-bbb-222', opponentElo: 1400, won: true, confidence: 0.72 },
  { opponentId: 'opp-ccc-333', opponentElo: 1500, won: false, confidence: 0.60 },
];

describe('VariantMatchHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows loading skeleton initially', () => {
    // Never-resolving promise keeps component in loading state
    mockGetMatchHistory.mockReturnValue(new Promise(() => {}));
    render(<VariantMatchHistory variantId="test-id" />);
    expect(screen.getByTestId('variant-match-history')).toBeInTheDocument();
    expect(screen.getByText('Match History')).toBeInTheDocument();
    // Should show animated skeleton placeholder divs (animate-pulse)
    const container = screen.getByTestId('variant-match-history');
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders match table after loading with win/loss results', async () => {
    mockGetMatchHistory.mockResolvedValue({ success: true, data: sampleMatches, error: null });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('match-row')).toHaveLength(3);
    });

    const rows = screen.getAllByTestId('match-row');
    expect(rows[0]).toHaveTextContent('WIN');
    expect(rows[1]).toHaveTextContent('WIN');
    expect(rows[2]).toHaveTextContent('LOSS');
  });

  it('shows "No match data" when empty array', async () => {
    mockGetMatchHistory.mockResolvedValue({ success: true, data: [], error: null });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      expect(screen.getByText('No match data available for this variant.')).toBeInTheDocument();
    });
  });

  it('shows win/loss summary (e.g., "2W / 1L")', async () => {
    mockGetMatchHistory.mockResolvedValue({ success: true, data: sampleMatches, error: null });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      expect(screen.getByText('2W')).toBeInTheDocument();
    });
    expect(screen.getByText('1L')).toBeInTheDocument();
    expect(screen.getByText(/3 total/)).toBeInTheDocument();
  });

  it('has data-testid="variant-match-history" and "match-row"', async () => {
    mockGetMatchHistory.mockResolvedValue({ success: true, data: sampleMatches, error: null });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('match-row').length).toBeGreaterThan(0);
    });
    expect(screen.getByTestId('variant-match-history')).toBeInTheDocument();
  });

  it('displays opponent short IDs', async () => {
    mockGetMatchHistory.mockResolvedValue({ success: true, data: sampleMatches, error: null });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      // Our inlined ShortId renders as a link with 8-char prefix
      const links = screen.getAllByRole('link');
      const oppLinks = links.filter(l => l.getAttribute('href')?.includes('/variants/opp-'));
      expect(oppLinks).toHaveLength(3);
      expect(oppLinks[0]).toHaveTextContent('opp-aaa-');
    });
  });

  it('displays opponent Elo ratings', async () => {
    mockGetMatchHistory.mockResolvedValue({ success: true, data: sampleMatches, error: null });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      expect(screen.getByText('1350')).toBeInTheDocument();
    });
    expect(screen.getByText('1400')).toBeInTheDocument();
    expect(screen.getByText('1500')).toBeInTheDocument();
  });

  it('displays confidence percentages', async () => {
    mockGetMatchHistory.mockResolvedValue({ success: true, data: sampleMatches, error: null });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      expect(screen.getByText('85%')).toBeInTheDocument();
    });
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('shows dash for null opponent Elo', async () => {
    const matchWithNullElo: VariantMatchEntry[] = [
      { opponentId: 'opp-null-elo', opponentElo: null, won: true, confidence: 0.9 },
    ];
    mockGetMatchHistory.mockResolvedValue({ success: true, data: matchWithNullElo, error: null });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      expect(screen.getAllByTestId('match-row')).toHaveLength(1);
    });
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows error message on action failure', async () => {
    mockGetMatchHistory.mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Server error' },
    });
    render(<VariantMatchHistory variantId="test-id" />);

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });
});
