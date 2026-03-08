// Tests for RelatedVariantsTab: fetches variants by run/invocation and renders EntityTable.

import { render, screen, waitFor } from '@testing-library/react';
import { RelatedVariantsTab } from './RelatedVariantsTab';

jest.mock('@evolution/services/evolutionActions', () => ({
  listVariantsAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      items: [
        { id: 'var-001', run_id: 'run-001', agent_name: 'improver', elo_score: 1250, generation: 2, is_winner: true, created_at: '2026-01-01T00:00:00Z', match_count: 5 },
        { id: 'var-002', run_id: 'run-001', agent_name: 'creator', elo_score: 1100, generation: 1, is_winner: false, created_at: '2026-01-01T01:00:00Z', match_count: 3 },
      ],
      total: 2,
    },
  }),
}));

describe('RelatedVariantsTab', () => {
  it('fetches variants by runId and renders table', async () => {
    render(<RelatedVariantsTab runId="run-001" />);
    await waitFor(() => {
      expect(screen.getByText(/var-001/)).toBeInTheDocument();
    });
    const { listVariantsAction } = require('@evolution/services/evolutionActions');
    expect(listVariantsAction).toHaveBeenCalledWith({ runId: 'run-001' });
  });

  it('shows winner badge', async () => {
    render(<RelatedVariantsTab runId="run-001" />);
    await waitFor(() => {
      expect(screen.getByText(/var-001/)).toBeInTheDocument();
    });
    // Winner badge rendered for is_winner=true variant
    const winnerBadges = screen.getAllByText('Winner');
    expect(winnerBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders row links to variant detail', async () => {
    render(<RelatedVariantsTab runId="run-001" />);
    await waitFor(() => {
      expect(screen.getByText(/var-001/)).toBeInTheDocument();
    });
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/admin/evolution/variants/var-001');
  });

  it('shows loading state', () => {
    render(<RelatedVariantsTab runId="run-001" />);
    expect(screen.getByTestId('related-variants-skeleton')).toBeInTheDocument();
  });

  it('shows empty state when no variants', async () => {
    const { listVariantsAction } = require('@evolution/services/evolutionActions');
    listVariantsAction.mockResolvedValueOnce({ success: true, data: { items: [], total: 0 } });
    render(<RelatedVariantsTab runId="run-empty" />);
    await waitFor(() => {
      expect(screen.getByText('No variants found.')).toBeInTheDocument();
    });
  });
});
