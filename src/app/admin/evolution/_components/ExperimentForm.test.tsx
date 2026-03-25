// Tests for ExperimentForm: V2 strategy-picker based experiment creation flow (auto-start).
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ExperimentForm } from './ExperimentForm';

// ─── Mocks ──────────────────────────────────────────────────────

const mockCreateWithRunsAction = jest.fn();
const mockGetPromptsAction = jest.fn();
const mockGetStrategiesAction = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('@evolution/services/experimentActions', () => ({
  createExperimentWithRunsAction: (...args: unknown[]) => mockCreateWithRunsAction(...args),
  getPromptsAction: (...args: unknown[]) => mockGetPromptsAction(...args),
  getStrategiesAction: (...args: unknown[]) => mockGetStrategiesAction(...args),
}));

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// ─── Fixtures ───────────────────────────────────────────────────

const PROMPTS = [
  { id: 'p1', name: 'Photosynthesis', prompt: 'Explain photosynthesis', status: 'active' as const, createdAt: '2026-01-01' },
  { id: 'p2', name: 'Gravity', prompt: 'Explain gravity briefly', status: 'active' as const, createdAt: '2026-01-02' },
];

const STRATEGIES = [
  {
    id: 'strat-1',
    name: 'Economy',
    label: 'Gen: ds-chat | Judge: 4.1-nano | 50 iters',
    config: {
      generationModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterations: 50,
      enabledAgents: [],
      budgetUsd: 0.25,
    },
    status: 'active',
    is_predefined: true,
  },
  {
    id: 'strat-2',
    name: 'Balanced',
    label: 'Gen: 4.1-mini | Judge: 4.1-nano | 50 iters',
    config: {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 50,
      enabledAgents: ['reflection'],
      budgetUsd: 0.50,
    },
    status: 'active',
    is_predefined: true,
  },
  {
    id: 'strat-3',
    name: 'Quality',
    label: 'Gen: 4.1 | Judge: 4.1-mini | 50 iters',
    config: {
      generationModel: 'gpt-4.1',
      judgeModel: 'gpt-4.1-mini',
      iterations: 50,
      enabledAgents: ['reflection', 'iterativeEditing'],
      budgetUsd: 1.00,
    },
    status: 'active',
    is_predefined: true,
  },
];

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPromptsAction.mockResolvedValue({ success: true, data: PROMPTS });
  mockGetStrategiesAction.mockResolvedValue({ success: true, data: STRATEGIES });
  mockCreateWithRunsAction.mockResolvedValue({ success: true, data: { experimentId: 'exp-1' } });
});

/** Fill setup step: enter name, select first prompt, and set budget to $1.00 so all strategies are eligible. */
async function fillSetup() {
  render(<ExperimentForm />);
  await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());

  fireEvent.change(screen.getByPlaceholderText('e.g., Model comparison Q1'), {
    target: { value: 'Test Experiment' },
  });
  const radios = screen.getAllByRole('radio');
  fireEvent.click(radios[0]);
  // Set budget high enough so all strategies are eligible
  const budgetInput = screen.getByDisplayValue('0.05');
  fireEvent.change(budgetInput, { target: { value: '1.00' } });
}

/** Fill setup and advance to strategies step. */
async function goToStrategiesStep() {
  await fillSetup();
  fireEvent.click(screen.getByText('Next: Select Strategies'));
  await waitFor(() => expect(screen.getByText('Select Strategies')).toBeInTheDocument());
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ExperimentForm', () => {
  describe('Step 1: Setup', () => {
    it('renders loading state then shows prompts', async () => {
      render(<ExperimentForm />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());
    });

    it('disables Next when name is empty', async () => {
      render(<ExperimentForm />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());
      fireEvent.click(screen.getAllByRole('radio')[0]);
      expect(screen.getByText('Next: Select Strategies')).toBeDisabled();
    });

    it('disables Next when no prompt selected', async () => {
      render(<ExperimentForm />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());
      fireEvent.change(screen.getByPlaceholderText('e.g., Model comparison Q1'), {
        target: { value: 'My Experiment' },
      });
      expect(screen.getByText('Next: Select Strategies')).toBeDisabled();
    });

    it('defaults budget per run to $0.05', async () => {
      render(<ExperimentForm />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());
      const budgetInput = screen.getByDisplayValue('0.05');
      expect(budgetInput).toBeInTheDocument();
    });

    it('enables Next when name and prompt are provided', async () => {
      await fillSetup();
      expect(screen.getByText('Next: Select Strategies')).not.toBeDisabled();
    });
  });

  describe('Step 2: Strategy Selection', () => {
    it('shows all strategies', async () => {
      await goToStrategiesStep();
      expect(screen.getByText('Economy')).toBeInTheDocument();
      expect(screen.getByText('Balanced')).toBeInTheDocument();
      expect(screen.getByText('Quality')).toBeInTheDocument();
    });

    it('fetches strategies from getStrategiesAction', async () => {
      await goToStrategiesStep();
      expect(mockGetStrategiesAction).toHaveBeenCalled();
    });

    it('greys out strategies over budget', async () => {
      render(<ExperimentForm />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());
      fireEvent.change(screen.getByPlaceholderText('e.g., Model comparison Q1'), {
        target: { value: 'Test Experiment' },
      });
      fireEvent.click(screen.getAllByRole('radio')[0]);
      // Set budget to $0.25 — only Economy should be eligible
      const budgetInput = screen.getByDisplayValue('0.05');
      fireEvent.change(budgetInput, { target: { value: '0.25' } });

      fireEvent.click(screen.getByText('Next: Select Strategies'));
      await waitFor(() => expect(screen.getByText('Select Strategies')).toBeInTheDocument());

      // Balanced ($0.50) and Quality ($1.00) should show "over budget"
      const overBudgetLabels = screen.getAllByText('— over budget');
      expect(overBudgetLabels).toHaveLength(2);
    });

    it('can select and deselect a strategy', async () => {
      await goToStrategiesStep();

      const checkbox = screen.getByTestId('strategy-check-strat-1');
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();

      // Runs input should appear
      expect(screen.getByTestId('runs-count-strat-1')).toBeInTheDocument();

      // Deselect
      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });

    it('updates run count per strategy', async () => {
      await goToStrategiesStep();

      // Select Economy
      fireEvent.click(screen.getByTestId('strategy-check-strat-1'));
      const runsInput = screen.getByTestId('runs-count-strat-1');
      fireEvent.change(runsInput, { target: { value: '3' } });
      expect(runsInput).toHaveValue(3);
    });

    it('shows total cost and blocks review when over budget', async () => {
      await goToStrategiesStep();

      // Select Economy with 21 runs at $1.00/run = $21.00 > $10 cap
      fireEvent.click(screen.getByTestId('strategy-check-strat-1'));
      const runsInput = screen.getByTestId('runs-count-strat-1');
      fireEvent.change(runsInput, { target: { value: '21' } });

      expect(screen.getByText(/exceeds/)).toBeInTheDocument();
      expect(screen.getByText('Review')).toBeDisabled();
    });

    it('disables Review when no strategies selected', async () => {
      await goToStrategiesStep();
      expect(screen.getByText('Review')).toBeDisabled();
    });

    it('can navigate back to setup', async () => {
      await goToStrategiesStep();
      fireEvent.click(screen.getByText('Back'));
      await waitFor(() => expect(screen.getByText('Experiment Name')).toBeInTheDocument());
    });
  });

  describe('Step 3: Review & Submit', () => {
    async function goToReview() {
      await goToStrategiesStep();
      // Select Economy
      fireEvent.click(screen.getByTestId('strategy-check-strat-1'));
      fireEvent.click(screen.getByText('Review'));
      await waitFor(() => expect(screen.getByText('Create Experiment')).toBeInTheDocument());
    }

    it('shows summary with correct info', async () => {
      await goToReview();
      expect(screen.getByText('Test Experiment')).toBeInTheDocument();
      expect(screen.getByText(/Total runs:/)).toBeInTheDocument();
    });

    it('shows strategy/run summary table', async () => {
      await goToReview();
      expect(screen.getByText('Strategy')).toBeInTheDocument();
      expect(screen.getByText('Runs')).toBeInTheDocument();
      expect(screen.getByText('Subtotal')).toBeInTheDocument();
      expect(screen.getByText('Economy')).toBeInTheDocument();
    });

    it('calls create + addRun actions on submit', async () => {
      const onCreated = jest.fn();
      render(<ExperimentForm onCreated={onCreated} />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());

      // Step 1: fill setup
      fireEvent.change(screen.getByPlaceholderText('e.g., Model comparison Q1'), {
        target: { value: 'My Experiment' },
      });
      fireEvent.click(screen.getAllByRole('radio')[0]);
      // Set budget high enough for Economy strategy (budgetUsd: 0.25)
      fireEvent.change(screen.getByDisplayValue('0.05'), { target: { value: '1.00' } });
      fireEvent.click(screen.getByText('Next: Select Strategies'));
      await waitFor(() => expect(screen.getByText('Select Strategies')).toBeInTheDocument());

      // Step 2: select Economy
      fireEvent.click(screen.getByTestId('strategy-check-strat-1'));
      fireEvent.click(screen.getByText('Review'));
      await waitFor(() => expect(screen.getByText('Create Experiment')).toBeInTheDocument());

      // Step 3: submit
      await act(async () => {
        fireEvent.click(screen.getByText('Create Experiment'));
      });

      await waitFor(() => {
        expect(mockCreateWithRunsAction).toHaveBeenCalledWith(expect.objectContaining({
          name: 'My Experiment',
          promptId: 'p1',
          runs: [{ strategy_id: 'strat-1', budget_cap_usd: 1.00 }],
        }));
        expect(onCreated).toHaveBeenCalledWith('exp-1');
        expect(mockToastSuccess).toHaveBeenCalled();
      });
    });

    it('submits multiple runs per strategy in batch', async () => {
      await goToStrategiesStep();

      // Select Economy with 3 runs
      fireEvent.click(screen.getByTestId('strategy-check-strat-1'));
      fireEvent.change(screen.getByTestId('runs-count-strat-1'), { target: { value: '3' } });

      fireEvent.click(screen.getByText('Review'));
      await waitFor(() => expect(screen.getByText('Create Experiment')).toBeInTheDocument());

      await act(async () => {
        fireEvent.click(screen.getByText('Create Experiment'));
      });

      await waitFor(() => {
        const call = mockCreateWithRunsAction.mock.calls[0][0];
        expect(call.runs).toHaveLength(3);
      });
    });

    it('submits runs for multiple strategies in batch', async () => {
      await goToStrategiesStep();

      // Select Economy (1 run) and Balanced (2 runs)
      fireEvent.click(screen.getByTestId('strategy-check-strat-1'));
      fireEvent.click(screen.getByTestId('strategy-check-strat-2'));
      fireEvent.change(screen.getByTestId('runs-count-strat-2'), { target: { value: '2' } });

      fireEvent.click(screen.getByText('Review'));
      await waitFor(() => expect(screen.getByText('Create Experiment')).toBeInTheDocument());

      await act(async () => {
        fireEvent.click(screen.getByText('Create Experiment'));
      });

      await waitFor(() => {
        const call = mockCreateWithRunsAction.mock.calls[0][0];
        // 1 + 2 = 3 total runs
        expect(call.runs).toHaveLength(3);
      });
    });

    it('shows error toast when batch create fails', async () => {
      mockCreateWithRunsAction.mockResolvedValue({
        success: false,
        data: null,
        error: { message: 'DB error' },
      });
      await goToReview();

      await act(async () => {
        fireEvent.click(screen.getByText('Create Experiment'));
      });

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('DB error');
      });
    });

    it('can navigate back to strategies step', async () => {
      await goToReview();
      fireEvent.click(screen.getByText('Back'));
      await waitFor(() => expect(screen.getByText('Select Strategies')).toBeInTheDocument());
    });
  });
});
