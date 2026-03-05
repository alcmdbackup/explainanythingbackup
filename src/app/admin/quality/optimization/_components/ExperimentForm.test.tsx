// Tests for ExperimentForm: multi-step manual experiment creation flow.
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ExperimentForm } from './ExperimentForm';

// ─── Mocks ──────────────────────────────────────────────────────

const mockCreateAction = jest.fn();
const mockAddRunAction = jest.fn();
const mockStartAction = jest.fn();
const mockGetPromptsAction = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('@evolution/services/experimentActions', () => ({
  createManualExperimentAction: (...args: unknown[]) => mockCreateAction(...args),
  addRunToExperimentAction: (...args: unknown[]) => mockAddRunAction(...args),
  startManualExperimentAction: (...args: unknown[]) => mockStartAction(...args),
}));

jest.mock('@evolution/services/promptRegistryActions', () => ({
  getPromptsAction: (...args: unknown[]) => mockGetPromptsAction(...args),
}));

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// ─── Fixtures ───────────────────────────────────────────────────

const PROMPTS = [
  { id: 'p1', title: 'Photosynthesis', prompt: 'Explain photosynthesis', status: 'active' as const, createdAt: '2026-01-01' },
  { id: 'p2', title: 'Gravity', prompt: 'Explain gravity briefly', status: 'active' as const, createdAt: '2026-01-02' },
];

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPromptsAction.mockResolvedValue({ success: true, data: PROMPTS });
  mockCreateAction.mockResolvedValue({ success: true, data: { experimentId: 'exp-1' } });
  mockAddRunAction.mockResolvedValue({ success: true, data: { runCount: 1 } });
  mockStartAction.mockResolvedValue({ success: true, data: { started: true } });
});

/** Navigate to step 1 with prompts loaded, enter a name, and select a prompt. */
async function fillSetup() {
  render(<ExperimentForm />);
  await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());

  fireEvent.change(screen.getByPlaceholderText('e.g., Model comparison Q1'), {
    target: { value: 'Test Experiment' },
  });
  // Select first prompt (radio button)
  const radios = screen.getAllByRole('radio');
  fireEvent.click(radios[0]);
}

/** Fill setup and advance to step 2. */
async function goToRunsStep() {
  await fillSetup();
  fireEvent.click(screen.getByText('Next: Configure Runs'));
  await waitFor(() => expect(screen.getByText('Run 1')).toBeInTheDocument());
}

/** Fill setup, go to runs, advance to review. */
async function goToReviewStep() {
  await goToRunsStep();
  fireEvent.click(screen.getByText('Review'));
  await waitFor(() => expect(screen.getByText('Start Experiment')).toBeInTheDocument());
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ExperimentForm', () => {
  describe('Step 1: Setup', () => {
    it('renders loading state then shows prompts', async () => {
      render(<ExperimentForm />);
      expect(screen.getByText('Loading prompts...')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());
    });

    it('disables Next when name is empty', async () => {
      render(<ExperimentForm />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());
      // Select a prompt but no name
      fireEvent.click(screen.getAllByRole('radio')[0]);
      expect(screen.getByText('Next: Configure Runs')).toBeDisabled();
    });

    it('disables Next when no prompt selected', async () => {
      render(<ExperimentForm />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());
      fireEvent.change(screen.getByPlaceholderText('e.g., Model comparison Q1'), {
        target: { value: 'My Experiment' },
      });
      expect(screen.getByText('Next: Configure Runs')).toBeDisabled();
    });

    it('enables Next when name and prompt are provided', async () => {
      await fillSetup();
      expect(screen.getByText('Next: Configure Runs')).not.toBeDisabled();
    });
  });

  describe('Step 2: Runs', () => {
    it('starts with one default run', async () => {
      await goToRunsStep();
      expect(screen.getByText('Run 1')).toBeInTheDocument();
      expect(screen.queryByText('Run 2')).not.toBeInTheDocument();
    });

    it('can add a run', async () => {
      await goToRunsStep();
      fireEvent.click(screen.getByText('+ Add Run'));
      expect(screen.getByText('Run 2')).toBeInTheDocument();
    });

    it('can remove a run when multiple exist', async () => {
      await goToRunsStep();
      fireEvent.click(screen.getByText('+ Add Run'));
      expect(screen.getByText('Run 2')).toBeInTheDocument();
      // Remove first run
      const removeButtons = screen.getAllByText('Remove');
      fireEvent.click(removeButtons[0]);
      expect(screen.queryByText('Run 2')).not.toBeInTheDocument();
      expect(screen.getByText('Run 1')).toBeInTheDocument();
    });

    it('does not show Remove button when only one run exists', async () => {
      await goToRunsStep();
      expect(screen.queryByText('Remove')).not.toBeInTheDocument();
    });

    it('can toggle optional agents', async () => {
      await goToRunsStep();
      const reflectionBtn = screen.getByRole('button', { name: 'reflection' });
      // Initially off (muted text)
      expect(reflectionBtn.className).toContain('text-[var(--text-muted)]');
      fireEvent.click(reflectionBtn);
      // Now on (gold bg)
      expect(reflectionBtn.className).toContain('bg-[var(--accent-gold)]');
    });

    it('can navigate back to setup', async () => {
      await goToRunsStep();
      fireEvent.click(screen.getByText('Back'));
      await waitFor(() => expect(screen.getByText('Experiment Name')).toBeInTheDocument());
    });
  });

  describe('Step 3: Review & Submit', () => {
    it('shows summary with correct info', async () => {
      await goToReviewStep();
      expect(screen.getByText('Test Experiment')).toBeInTheDocument();
      // Runs count shown
      expect(screen.getByText(/Runs:/)).toBeInTheDocument();
    });

    it('shows run summary table', async () => {
      await goToReviewStep();
      // Table has model columns
      expect(screen.getByText('Model')).toBeInTheDocument();
      expect(screen.getByText('Judge')).toBeInTheDocument();
    });

    it('calls all 3 actions on submit', async () => {
      const onStarted = jest.fn();
      render(<ExperimentForm onStarted={onStarted} />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());

      // Step 1
      fireEvent.change(screen.getByPlaceholderText('e.g., Model comparison Q1'), {
        target: { value: 'My Experiment' },
      });
      fireEvent.click(screen.getAllByRole('radio')[0]); // select prompt
      fireEvent.click(screen.getByText('Next: Configure Runs'));
      await waitFor(() => expect(screen.getByText('Run 1')).toBeInTheDocument());

      // Step 2 — go straight to review with defaults
      fireEvent.click(screen.getByText('Review'));
      await waitFor(() => expect(screen.getByText('Start Experiment')).toBeInTheDocument());

      // Step 3
      await act(async () => {
        fireEvent.click(screen.getByText('Start Experiment'));
      });

      await waitFor(() => {
        expect(mockCreateAction).toHaveBeenCalledWith({
          name: 'My Experiment',
          promptId: 'p1',
          target: 'elo',
        });
        expect(mockAddRunAction).toHaveBeenCalledTimes(1);
        expect(mockStartAction).toHaveBeenCalledWith({ experimentId: 'exp-1' });
        expect(onStarted).toHaveBeenCalledWith('exp-1');
        expect(mockToastSuccess).toHaveBeenCalled();
      });
    });

    it('shows error toast when create fails', async () => {
      mockCreateAction.mockResolvedValue({
        success: false,
        data: null,
        error: { message: 'DB error' },
      });
      await goToReviewStep();

      await act(async () => {
        fireEvent.click(screen.getByText('Start Experiment'));
      });

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('DB error');
      });
    });

    it('shows error toast when addRun fails', async () => {
      mockAddRunAction.mockResolvedValue({
        success: false,
        data: null,
        error: { message: 'Budget exceeded' },
      });
      await goToReviewStep();

      await act(async () => {
        fireEvent.click(screen.getByText('Start Experiment'));
      });

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Budget exceeded');
        // Should not try to start
        expect(mockStartAction).not.toHaveBeenCalled();
      });
    });

    it('can navigate back to runs step', async () => {
      await goToReviewStep();
      fireEvent.click(screen.getByText('Back'));
      await waitFor(() => expect(screen.getByText('Run 1')).toBeInTheDocument());
    });
  });

  describe('Multiple runs submission', () => {
    it('calls addRunToExperiment for each run', async () => {
      render(<ExperimentForm />);
      await waitFor(() => expect(screen.getByText('Photosynthesis')).toBeInTheDocument());

      // Setup
      fireEvent.change(screen.getByPlaceholderText('e.g., Model comparison Q1'), {
        target: { value: 'Multi-run' },
      });
      fireEvent.click(screen.getAllByRole('radio')[0]);
      fireEvent.click(screen.getByText('Next: Configure Runs'));
      await waitFor(() => expect(screen.getByText('Run 1')).toBeInTheDocument());

      // Add second run
      fireEvent.click(screen.getByText('+ Add Run'));
      expect(screen.getByText('Run 2')).toBeInTheDocument();

      // Go to review and submit
      fireEvent.click(screen.getByText('Review'));
      await waitFor(() => expect(screen.getByText('Start Experiment')).toBeInTheDocument());

      await act(async () => {
        fireEvent.click(screen.getByText('Start Experiment'));
      });

      await waitFor(() => {
        expect(mockAddRunAction).toHaveBeenCalledTimes(2);
      });
    });
  });
});
