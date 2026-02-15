// Tests for VariantsTab component: loading, table rendering, error, filtering, expand/collapse, and empty state.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VariantsTab } from './VariantsTab';
import * as evolutionActions from '@/lib/services/evolutionActions';
import * as visualizationActions from '@/lib/services/evolutionVisualizationActions';
import type { EvolutionVariant } from '@/lib/services/evolutionActions';

jest.mock('@/lib/services/evolutionActions', () => ({
  getEvolutionVariantsAction: jest.fn(),
}));

jest.mock('@/lib/services/evolutionVisualizationActions', () => ({
  getEvolutionRunEloHistoryAction: jest.fn(),
  getEvolutionRunStepScoresAction: jest.fn(),
}));

// Mock sub-components that rely on canvas/SVG
jest.mock('@/components/evolution', () => ({
  EloSparkline: () => <span data-testid="elo-sparkline" />,
}));

jest.mock('@/components/evolution/StepScoreBar', () => ({
  StepScoreBar: () => <span data-testid="step-score-bar" />,
}));

const mockVariants: EvolutionVariant[] = [
  {
    id: 'aaaa-1111-bbbb-2222-cccc-3333',
    run_id: 'run-1',
    explanation_id: 1,
    variant_content: 'First variant content',
    elo_score: 1400,
    generation: 2,
    agent_name: 'evolution',
    match_count: 10,
    is_winner: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'dddd-4444-eeee-5555-ffff-6666',
    run_id: 'run-1',
    explanation_id: 1,
    variant_content: 'Second variant content',
    elo_score: 1250,
    generation: 1,
    agent_name: 'generation',
    match_count: 8,
    is_winner: false,
    created_at: '2026-01-01T00:01:00Z',
  },
];

function setupMocks(variants: EvolutionVariant[] = mockVariants) {
  (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
    success: true,
    data: variants,
    error: null,
  });
  (visualizationActions.getEvolutionRunEloHistoryAction as jest.Mock).mockResolvedValue({
    success: true,
    data: { variants: [], history: [] },
    error: null,
  });
  (visualizationActions.getEvolutionRunStepScoresAction as jest.Mock).mockResolvedValue({
    success: true,
    data: [],
    error: null,
  });
}

describe('VariantsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading skeleton initially', () => {
    // Never-resolving promise keeps the loading state
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockImplementation(
      () => new Promise(() => {})
    );
    (visualizationActions.getEvolutionRunEloHistoryAction as jest.Mock).mockImplementation(
      () => new Promise(() => {})
    );
    (visualizationActions.getEvolutionRunStepScoresAction as jest.Mock).mockImplementation(
      () => new Promise(() => {})
    );

    render(<VariantsTab runId="run-1" />);

    // Should show skeleton pulses, not the data-testid
    expect(screen.queryByTestId('variants-tab')).not.toBeInTheDocument();
  });

  it('renders variant table rows after load', async () => {
    setupMocks();

    render(<VariantsTab runId="run-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('variants-tab')).toBeInTheDocument();
    });

    // Should show both variant IDs (truncated to 6 chars inline in rank cell)
    expect(screen.getByText('aaaa-1')).toBeInTheDocument();
    expect(screen.getByText('dddd-4')).toBeInTheDocument();

    // Should show Elo scores
    expect(screen.getByText('1400')).toBeInTheDocument();
    expect(screen.getByText('1250')).toBeInTheDocument();

    // Winner star should be present
    expect(screen.getByText('★')).toBeInTheDocument();
  });

  it('shows error message on failure', async () => {
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Server unavailable' },
    });
    (visualizationActions.getEvolutionRunEloHistoryAction as jest.Mock).mockResolvedValue({
      success: true, data: { variants: [], history: [] }, error: null,
    });
    (visualizationActions.getEvolutionRunStepScoresAction as jest.Mock).mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<VariantsTab runId="run-1" />);

    await waitFor(() => {
      expect(screen.getByText('Server unavailable')).toBeInTheDocument();
    });
  });

  it('strategy filter filters rows', async () => {
    setupMocks();

    render(<VariantsTab runId="run-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('variants-tab')).toBeInTheDocument();
    });

    // Both rows visible initially
    expect(screen.getByText('aaaa-1')).toBeInTheDocument();
    expect(screen.getByText('dddd-4')).toBeInTheDocument();

    // Filter to 'generation' only
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'generation' } });

    // Only the generation variant should be visible
    expect(screen.queryByText('aaaa-1')).not.toBeInTheDocument();
    expect(screen.getByText('dddd-4')).toBeInTheDocument();
  });

  it('expand/collapse variant text', async () => {
    setupMocks();

    render(<VariantsTab runId="run-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('variants-tab')).toBeInTheDocument();
    });

    // Content should not be visible initially
    expect(screen.queryByText('First variant content')).not.toBeInTheDocument();

    // Click "View" on first variant
    const viewButtons = screen.getAllByText('View');
    fireEvent.click(viewButtons[0]);

    // Content should now be visible
    expect(screen.getByText('First variant content')).toBeInTheDocument();

    // Click "Hide" to collapse
    fireEvent.click(screen.getByText('Hide'));
    expect(screen.queryByText('First variant content')).not.toBeInTheDocument();
  });

  it('empty state renders table with no rows', async () => {
    setupMocks([]);

    render(<VariantsTab runId="run-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('variants-tab')).toBeInTheDocument();
    });

    // Table headers should exist but no data rows
    expect(screen.getByText('Rank')).toBeInTheDocument();
    expect(screen.getByText('Elo')).toBeInTheDocument();
    // No variant IDs (6-char truncation)
    expect(screen.queryByText(/^[a-f0-9]{6}$/)).not.toBeInTheDocument();
  });
});
