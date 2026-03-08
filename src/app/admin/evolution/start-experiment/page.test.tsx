// Tests for start experiment page rendering.

import { render, screen } from '@testing-library/react';
import StartExperimentPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/start-experiment',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/experimentActions', () => ({
  createManualExperimentAction: jest.fn(),
  addRunToExperimentAction: jest.fn(),
  startManualExperimentAction: jest.fn(),
  getExperimentStatusAction: jest.fn(),
  cancelExperimentAction: jest.fn(),
}));

jest.mock('@evolution/services/promptRegistryActions', () => ({
  getPromptsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

jest.mock('@evolution/services/strategyRegistryActions', () => ({
  getStrategiesAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
}));

describe('StartExperimentPage', () => {
  it('renders page heading', () => {
    render(<StartExperimentPage />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Start Experiment');
  });

  it('renders breadcrumb with Dashboard link', () => {
    render(<StartExperimentPage />);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders experiment form loading state', () => {
    render(<StartExperimentPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });
});
