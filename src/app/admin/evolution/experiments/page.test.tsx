// Tests for experiments list page rendering.

import { render, screen } from '@testing-library/react';
import ExperimentsListPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/experiments',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/experimentActions', () => ({
  listExperimentsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
  cancelExperimentAction: jest.fn(),
}));

describe('ExperimentsListPage', () => {
  it('renders page title', () => {
    render(<ExperimentsListPage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Experiments');
  });

  it('renders breadcrumb with Dashboard link', () => {
    render(<ExperimentsListPage />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders ExperimentHistory component', () => {
    render(<ExperimentsListPage />);
    expect(screen.getByText('Experiment History')).toBeInTheDocument();
  });
});
