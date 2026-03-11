// Tests for variants list page rendering using EntityListPage.

import { render, screen } from '@testing-library/react';
import VariantsListPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/variants',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  listVariantsAction: jest.fn(),
}));

import { listVariantsAction } from '@evolution/services/evolutionActions';

describe('VariantsListPage', () => {
  beforeEach(() => {
    (listVariantsAction as jest.Mock).mockResolvedValue({ success: true, data: { items: [], total: 0 } });
  });

  it('renders page heading', () => {
    render(<VariantsListPage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Variants');
  });

  it('renders breadcrumb with Dashboard link', () => {
    render(<VariantsListPage />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders filter controls', () => {
    render(<VariantsListPage />);
    expect(screen.getByTestId('filter-runId')).toBeInTheDocument();
    expect(screen.getByTestId('filter-agent')).toBeInTheDocument();
    expect(screen.getByTestId('filter-winner')).toBeInTheDocument();
  });

  it('renders entity list page wrapper', () => {
    render(<VariantsListPage />);
    expect(screen.getByTestId('entity-list-page')).toBeInTheDocument();
  });

  it('renders Strategy column header and data', async () => {
    (listVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        items: [{
          id: 'var-1',
          run_id: 'run-1',
          explanation_id: null,
          elo_score: 1200,
          generation: 1,
          agent_name: 'generator',
          match_count: 5,
          is_winner: false,
          created_at: '2026-01-01T00:00:00Z',
          elo_attribution: null,
          strategy_name: 'Test Strategy',
        }],
        total: 1,
      },
    });
    render(<VariantsListPage />);
    expect(await screen.findByText('Strategy')).toBeInTheDocument();
    expect(screen.getByText('Test Strategy')).toBeInTheDocument();
  });

  it('renders "—" when strategy_name is null', async () => {
    (listVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: {
        items: [{
          id: 'var-2',
          run_id: 'run-2',
          explanation_id: null,
          elo_score: 1000,
          generation: 1,
          agent_name: 'generator',
          match_count: 0,
          is_winner: false,
          created_at: '2026-01-01T00:00:00Z',
          elo_attribution: null,
          strategy_name: null,
        }],
        total: 1,
      },
    });
    render(<VariantsListPage />);
    const dash = await screen.findByText('—');
    expect(dash).toBeInTheDocument();
  });
});
