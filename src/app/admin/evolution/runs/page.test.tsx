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
});
