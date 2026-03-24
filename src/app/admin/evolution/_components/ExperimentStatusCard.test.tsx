// Tests for ExperimentStatusCard: status display, progress, cancel, polling.

import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ExperimentStatusCard } from './ExperimentStatusCard';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => <div data-testid="card" {...props}>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

const mockGetExperiment = jest.fn();
const mockCancelExperiment = jest.fn();

jest.mock('@evolution/services/experimentActions', () => ({
  getExperimentAction: (...args: unknown[]) => mockGetExperiment(...args),
  cancelExperimentAction: (...args: unknown[]) => mockCancelExperiment(...args),
}));

function makeExperiment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'exp-1',
    name: 'Test Experiment',
    status: 'completed',
    evolution_runs: [
      { id: 'r1', status: 'completed' },
      { id: 'r2', status: 'completed' },
    ],
    metrics: { totalCost: 1.50, maxElo: 1450 },
    ...overrides,
  };
}

describe('ExperimentStatusCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetExperiment.mockResolvedValue({ success: true, data: makeExperiment(), error: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows loading state initially', () => {
    mockGetExperiment.mockReturnValue(new Promise(() => {}));
    render(<ExperimentStatusCard experimentId="exp-1" />);
    expect(screen.getByText('Loading experiment...')).toBeInTheDocument();
  });

  it('renders experiment name and status', async () => {
    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText('Test Experiment')).toBeInTheDocument();
    });
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('shows run progress count', async () => {
    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText('2/2 runs')).toBeInTheDocument();
    });
  });

  it('shows total cost', async () => {
    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText('$1.50')).toBeInTheDocument();
    });
  });

  it('shows max elo value', async () => {
    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText('1450')).toBeInTheDocument();
    });
  });

  it('shows -- when max elo is null', async () => {
    mockGetExperiment.mockResolvedValue({
      success: true,
      data: makeExperiment({ metrics: { totalCost: 0, maxElo: null } }),
      error: null,
    });
    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText('--')).toBeInTheDocument();
    });
  });

  it('shows cancel button for active experiments', async () => {
    mockGetExperiment.mockResolvedValue({
      success: true,
      data: makeExperiment({ status: 'running' }),
      error: null,
    });
    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  it('hides cancel button for completed experiments', async () => {
    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText('Test Experiment')).toBeInTheDocument();
    });
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });

  it('calls cancelExperimentAction on cancel click', async () => {
    mockGetExperiment.mockResolvedValue({
      success: true,
      data: makeExperiment({ status: 'running' }),
      error: null,
    });
    mockCancelExperiment.mockResolvedValue({ success: true, data: { cancelled: true }, error: null });

    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    expect(mockCancelExperiment).toHaveBeenCalledWith({ experimentId: 'exp-1' });
  });

  it('calls onCancelled callback after successful cancel', async () => {
    const onCancelled = jest.fn();
    mockGetExperiment.mockResolvedValue({
      success: true,
      data: makeExperiment({ status: 'running' }),
      error: null,
    });
    mockCancelExperiment.mockResolvedValue({ success: true, data: { cancelled: true }, error: null });

    render(<ExperimentStatusCard experimentId="exp-1" onCancelled={onCancelled} />);
    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Cancel'));
    });

    expect(onCancelled).toHaveBeenCalled();
  });

  it('shows failed run count', async () => {
    mockGetExperiment.mockResolvedValue({
      success: true,
      data: makeExperiment({
        evolution_runs: [
          { id: 'r1', status: 'completed' },
          { id: 'r2', status: 'failed' },
          { id: 'r3', status: 'running' },
        ],
      }),
      error: null,
    });
    render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(screen.getByText(/1 failed/)).toBeInTheDocument();
    });
  });

  it('renders nothing when experiment not found', async () => {
    mockGetExperiment.mockResolvedValue({ success: false, data: null, error: null });
    const { container } = render(<ExperimentStatusCard experimentId="exp-1" />);
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
    // Card should not render
    expect(screen.queryByText('Test Experiment')).not.toBeInTheDocument();
  });
});
