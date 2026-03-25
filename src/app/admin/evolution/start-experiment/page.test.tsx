// Tests for start experiment page rendering.

import { render, screen } from '@testing-library/react';
import StartExperimentPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/start-experiment',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/services/experimentActions', () => ({
  createExperimentAction: jest.fn(),
  addRunToExperimentAction: jest.fn(),
  cancelExperimentAction: jest.fn(),
  getExperimentAction: jest.fn(),
  listExperimentsAction: jest.fn(),
  getPromptsAction: jest.fn().mockResolvedValue({ success: true, data: [] }),
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

  it('renders breadcrumb with Start Experiment text', () => {
    render(<StartExperimentPage />);
    const breadcrumb = screen.getByTestId('evolution-breadcrumb');
    expect(breadcrumb).toHaveTextContent('Start Experiment');
  });

  it('renders the experiment form container', () => {
    render(<StartExperimentPage />);
    const grid = document.querySelector('.grid');
    expect(grid).toBeInTheDocument();
  });

  it('calls getPromptsAction to load prompt options', () => {
    const { getPromptsAction } = jest.requireMock('@evolution/services/experimentActions');
    render(<StartExperimentPage />);
    expect(getPromptsAction).toHaveBeenCalled();
  });

  it('calls getStrategiesAction to load strategy options', () => {
    const { getStrategiesAction } = jest.requireMock('@evolution/services/experimentActions');
    render(<StartExperimentPage />);
    expect(getStrategiesAction).toHaveBeenCalled();
  });

  it('renders page within main layout structure', () => {
    const { container } = render(<StartExperimentPage />);
    const mainDiv = container.firstChild as HTMLElement;
    expect(mainDiv).toBeInTheDocument();
    expect(mainDiv.className).toContain('space-y-6');
  });
});
