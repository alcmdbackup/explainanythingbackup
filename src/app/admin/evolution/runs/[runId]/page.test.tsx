// Tests for run detail page rendering.

import { render, screen, waitFor, within } from '@testing-library/react';
import EvolutionRunDetailPage from './page';
import { getEvolutionRunByIdAction } from '@evolution/services/evolutionActions';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/runs/run-abc12345',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ runId: 'run-abc12345' }),
}));

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionRunByIdAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'run-abc12345',
      status: 'completed',
      phase: 'done',
      current_iteration: 5,
      total_cost_usd: 0.5,
      budget_cap_usd: 1.0,
      strategy_config_id: null,
      prompt_id: null,
      experiment_id: null,
      started_at: '2026-01-01T00:00:00Z',
      error_message: null,
    },
  }),
}));

jest.mock('@evolution/services/strategyRegistryActions', () => ({
  getStrategyDetailAction: jest.fn().mockResolvedValue({ success: false, data: null, error: null }),
}));

jest.mock('@evolution/services/promptRegistryActions', () => ({
  getPromptTitleAction: jest.fn().mockResolvedValue({ success: false, data: null, error: null }),
}));

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentNameAction: jest.fn().mockResolvedValue({ success: false, data: null, error: null }),
}));

jest.mock('@evolution/components/evolution/tabs/TimelineTab', () => ({
  TimelineTab: () => <div data-testid="timeline-tab">timeline-content</div>,
}));

jest.mock('@evolution/components/evolution/tabs/EloTab', () => ({
  EloTab: () => <div>EloTab</div>,
}));

jest.mock('@evolution/components/evolution/tabs/LineageTab', () => ({
  LineageTab: () => <div>LineageTab</div>,
}));

jest.mock('@evolution/components/evolution/tabs/VariantsTab', () => ({
  VariantsTab: () => <div>VariantsTab</div>,
}));

jest.mock('@evolution/components/evolution/tabs/LogsTab', () => ({
  LogsTab: () => <div>LogsTab</div>,
}));

describe('EvolutionRunDetailPage', () => {
  it('renders loading state initially', () => {
    render(<EvolutionRunDetailPage />);
    const skeleton = document.querySelector('.animate-pulse');
    expect(skeleton).toBeInTheDocument();
  });

  it('renders breadcrumb with Runs link after loading', async () => {
    render(<EvolutionRunDetailPage />);
    const runsLink = await screen.findByText('Runs');
    expect(runsLink.closest('a')).toHaveAttribute('href', '/admin/evolution/runs');
  });

  it('renders breadcrumb nav after loading', async () => {
    render(<EvolutionRunDetailPage />);
    const breadcrumb = await screen.findByTestId('evolution-breadcrumb');
    expect(breadcrumb).toBeInTheDocument();
  });

  it('renders tab bar after loading', async () => {
    render(<EvolutionRunDetailPage />);
    const tabBar = await screen.findByTestId('tab-bar');
    const tabs = within(tabBar);
    expect(tabs.getByText('Timeline')).toBeInTheDocument();
    expect(tabs.getByText('Rating')).toBeInTheDocument();
    expect(tabs.getByText('Lineage')).toBeInTheDocument();
    expect(tabs.getByText('Variants')).toBeInTheDocument();
    expect(tabs.getByText('Logs')).toBeInTheDocument();
  });

  it('shows not found when run data is null', async () => {
    jest.mocked(getEvolutionRunByIdAction).mockResolvedValueOnce({ success: false, data: null, error: null });
    render(<EvolutionRunDetailPage />);
    await screen.findByText(/Run not found/);
  });
});
