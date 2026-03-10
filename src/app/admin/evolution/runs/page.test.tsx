// Tests for simplified runs list page rendering.

import { render, screen } from '@testing-library/react';
import EvolutionRunsPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/runs',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunsAction: jest.fn(),
  killEvolutionRunAction: jest.fn(),
}));

jest.mock('@evolution/services/evolutionRunClient', () => ({
  triggerEvolutionRun: jest.fn(),
}));

import { getEvolutionRunsAction } from '@evolution/services/evolutionActions';

describe('EvolutionRunsPage', () => {
  beforeEach(() => {
    (getEvolutionRunsAction as jest.Mock).mockResolvedValue({ success: true, data: [] });
  });

  it('renders page heading', () => {
    render(<EvolutionRunsPage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Pipeline Runs');
  });

  it('renders breadcrumb with Dashboard link', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders date and status filters', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByTestId('evolution-date-filter')).toBeInTheDocument();
    expect(screen.getByTestId('evolution-status-filter')).toBeInTheDocument();
  });

  it('renders refresh button', () => {
    render(<EvolutionRunsPage />);
    expect(screen.getByRole('button', { name: /refresh|loading/i })).toBeInTheDocument();
  });

  it('does not render summary cards or start run card', () => {
    render(<EvolutionRunsPage />);
    expect(screen.queryByTestId('summary-cards')).not.toBeInTheDocument();
    expect(screen.queryByTestId('start-run-card')).not.toBeInTheDocument();
  });

  it('renders Experiment and Strategy column headers', async () => {
    (getEvolutionRunsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: [{
        id: 'run-1',
        explanation_id: null,
        status: 'completed',
        phase: 'done',
        total_variants: 3,
        total_cost_usd: 1.5,
        estimated_cost_usd: 1.0,
        budget_cap_usd: 5.0,
        current_iteration: 2,
        error_message: null,
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T01:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        prompt_id: null,
        pipeline_type: null,
        strategy_config_id: 'strat-1',
        experiment_id: 'exp-1',
        archived: false,
        experiment_name: 'Test Experiment',
        strategy_name: 'Test Strategy',
      }],
    });
    render(<EvolutionRunsPage />);
    expect(await screen.findByText('Experiment')).toBeInTheDocument();
    expect(screen.getByText('Strategy')).toBeInTheDocument();
    expect(screen.getByText('Test Experiment')).toBeInTheDocument();
    expect(screen.getByText('Test Strategy')).toBeInTheDocument();
  });

  it('renders "—" when experiment_name and strategy_name are null', async () => {
    (getEvolutionRunsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: [{
        id: 'run-2',
        explanation_id: null,
        status: 'completed',
        phase: 'done',
        total_variants: 1,
        total_cost_usd: 0.5,
        estimated_cost_usd: null,
        budget_cap_usd: 5.0,
        current_iteration: 1,
        error_message: null,
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T01:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        prompt_id: null,
        pipeline_type: null,
        strategy_config_id: null,
        experiment_id: null,
        archived: false,
        experiment_name: null,
        strategy_name: null,
      }],
    });
    render(<EvolutionRunsPage />);
    await screen.findByText('Pipeline Runs');
    const dashes = await screen.findAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
