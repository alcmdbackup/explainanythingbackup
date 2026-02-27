// Tests for ExperimentForm: run preview table, budget warning, start-blocking, collapsible behavior.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExperimentForm } from './ExperimentForm';
import type { RunPreviewRow, ValidateExperimentOutput, FactorMetadata } from '@evolution/services/experimentActions';

// ─── Mocks ──────────────────────────────────────────────────────

const mockValidateAction = jest.fn();
const mockStartAction = jest.fn();
const mockGetFactorMetadataAction = jest.fn();
const mockGetPromptsAction = jest.fn();

jest.mock('@evolution/services/experimentActions', () => ({
  validateExperimentConfigAction: (...args: unknown[]) => mockValidateAction(...args),
  startExperimentAction: (...args: unknown[]) => mockStartAction(...args),
  getFactorMetadataAction: (...args: unknown[]) => mockGetFactorMetadataAction(...args),
}));

jest.mock('@evolution/services/promptRegistryActions', () => ({
  getPromptsAction: (...args: unknown[]) => mockGetPromptsAction(...args),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

// ─── Fixtures ───────────────────────────────────────────────────

const FACTOR_META: FactorMetadata[] = [
  { key: 'genModel', label: 'Generation Model', type: 'model', validValues: ['gpt-4.1-mini', 'gpt-4o'] },
  { key: 'iterations', label: 'Iterations', type: 'integer', validValues: [5, 10, 15] },
  { key: 'supportAgents', label: 'Support Agents', type: 'toggle', validValues: ['off', 'on'] },
];

const PROMPTS = [
  { id: 'p1', title: 'Photosynthesis', prompt: 'Explain photosynthesis', status: 'active' as const, createdAt: '2026-01-01' },
];

function makePreviewRow(overrides?: Partial<RunPreviewRow>): RunPreviewRow {
  return {
    row: 1,
    factors: { genModel: 'gpt-4o', iterations: 15, supportAgents: 'on' },
    enabledAgents: ['reflection', 'debate'],
    effectiveBudgetCaps: { generation: 0.35, calibration: 0.26, tournament: 0.15, proximity: 0.05, reflection: 0.10, debate: 0.09 },
    estimatedCostPerPrompt: 2.50,
    confidence: 'medium',
    ...overrides,
  };
}

function makeValidOutput(overrides?: Partial<ValidateExperimentOutput>): ValidateExperimentOutput {
  return {
    valid: true,
    errors: [],
    warnings: [],
    expandedRunCount: 8,
    estimatedCost: 20.0,
    runPreview: Array.from({ length: 8 }, (_, i) => makePreviewRow({ row: i + 1 })),
    perRunBudget: 6.25,
    budgetSufficient: true,
    ...overrides,
  };
}

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockGetFactorMetadataAction.mockResolvedValue({ success: true, data: FACTOR_META });
  mockGetPromptsAction.mockResolvedValue({ success: true, data: PROMPTS });
  mockValidateAction.mockResolvedValue({ success: true, data: makeValidOutput() });
  mockStartAction.mockResolvedValue({ success: true, data: { experimentId: 'exp-1' } });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Enable 2 factors and 1 prompt to pass client validation, then trigger debounced server validation. */
async function setupValidForm() {
  render(<ExperimentForm />);
  // Wait for metadata to load
  await waitFor(() => expect(screen.getByText('Generation Model')).toBeInTheDocument());

  // Enable 2 factors
  const checkboxes = screen.getAllByRole('checkbox');
  fireEvent.click(checkboxes[0]); // genModel
  fireEvent.click(checkboxes[1]); // iterations

  // Select a prompt
  fireEvent.click(checkboxes[3]); // first prompt checkbox (after 3 factor checkboxes)

  // Fire debounced validation
  jest.advanceTimersByTime(600);
  await waitFor(() => expect(mockValidateAction).toHaveBeenCalled());
}

// ─── Tests ──────────────────────────────────────────────────────

describe('ExperimentForm', () => {
  it('renders run preview table when validation returns runPreview', async () => {
    await setupValidForm();
    await waitFor(() => expect(screen.getByText(/Run Preview/)).toBeInTheDocument());
  });

  it('preview is collapsed by default', async () => {
    await setupValidForm();
    await waitFor(() => expect(screen.getByText(/Run Preview/)).toBeInTheDocument());
    // Table should not be visible (collapsed)
    expect(screen.queryByText('Row')).not.toBeInTheDocument();
  });

  it('clicking preview toggle expands the table', async () => {
    await setupValidForm();
    await waitFor(() => expect(screen.getByText(/Run Preview/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Run Preview/));
    await waitFor(() => expect(screen.getByText('Row')).toBeInTheDocument());
  });

  it('shows budget warning banner when budgetWarning present', async () => {
    mockValidateAction.mockResolvedValue({
      success: true,
      data: makeValidOutput({
        budgetSufficient: false,
        budgetWarning: 'Per-run budget $0.0063 is below estimated cost',
      }),
    });
    await setupValidForm();
    await waitFor(() => expect(screen.getByTestId('budget-warning')).toBeInTheDocument());
    expect(screen.getByTestId('budget-warning')).toHaveTextContent('below estimated cost');
  });

  it('auto-expands preview when budget warning present', async () => {
    mockValidateAction.mockResolvedValue({
      success: true,
      data: makeValidOutput({
        budgetSufficient: false,
        budgetWarning: 'Budget too low',
      }),
    });
    await setupValidForm();
    // Preview should auto-expand, so table headers should be visible
    await waitFor(() => expect(screen.getByText('Row')).toBeInTheDocument());
  });

  it('disables Start button when budgetSufficient is false', async () => {
    mockValidateAction.mockResolvedValue({
      success: true,
      data: makeValidOutput({ budgetSufficient: false, budgetWarning: 'Too low' }),
    });
    await setupValidForm();
    await waitFor(() => {
      const startButton = screen.getByRole('button', { name: 'Start Experiment' });
      expect(startButton).toBeDisabled();
    });
  });

  it('enables Start button when budgetSufficient is true', async () => {
    await setupValidForm();
    await waitFor(() => {
      const startButton = screen.getByRole('button', { name: 'Start Experiment' });
      expect(startButton).not.toBeDisabled();
    });
  });

  it('preview table has correct number of rows', async () => {
    await setupValidForm();
    await waitFor(() => expect(screen.getByText(/Run Preview/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Run Preview/));
    await waitFor(() => {
      const rows = screen.getAllByTestId(/^preview-row-/);
      expect(rows).toHaveLength(8);
    });
  });

  it('factor columns appear in preview table headers', async () => {
    await setupValidForm();
    await waitFor(() => expect(screen.getByText(/Run Preview/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Run Preview/));
    await waitFor(() => {
      expect(screen.getByText('genModel')).toBeInTheDocument();
      expect(screen.getByText('iterations')).toBeInTheDocument();
    });
  });

  it('shows per-agent budget bars when row is expanded', async () => {
    await setupValidForm();
    await waitFor(() => expect(screen.getByText(/Run Preview/)).toBeInTheDocument());
    // Open preview
    fireEvent.click(screen.getByText(/Run Preview/));
    await waitFor(() => expect(screen.getByTestId('preview-row-1')).toBeInTheDocument());
    // Click row 1 to expand
    fireEvent.click(screen.getByTestId('preview-row-1'));
    await waitFor(() => {
      expect(screen.getByTestId('agent-detail-1')).toBeInTheDocument();
      expect(screen.getByText('generation')).toBeInTheDocument();
      expect(screen.getByText('calibration')).toBeInTheDocument();
    });
  });

  it('highlights agent caps below $0.01 in error color', async () => {
    mockValidateAction.mockResolvedValue({
      success: true,
      data: makeValidOutput({
        perRunBudget: 0.001, // Very tiny budget → all agent caps < $0.01
      }),
    });
    await setupValidForm();
    await waitFor(() => expect(screen.getByText(/Run Preview/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Run Preview/));
    await waitFor(() => expect(screen.getByTestId('preview-row-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('preview-row-1'));
    await waitFor(() => {
      const detail = screen.getByTestId('agent-detail-1');
      // All dollar values should be in error color (they're all < $0.01)
      const spans = detail.querySelectorAll('span');
      const errorSpans = Array.from(spans).filter(s => s.className.includes('status-error'));
      expect(errorSpans.length).toBeGreaterThan(0);
    });
  });

  it('hides preview when validation has errors', async () => {
    mockValidateAction.mockResolvedValue({
      success: true,
      data: {
        valid: false,
        errors: ['Bad config'],
        warnings: [],
        expandedRunCount: 0,
        estimatedCost: 0,
      },
    });
    await setupValidForm();
    await waitFor(() => expect(screen.getByText('Bad config')).toBeInTheDocument());
    expect(screen.queryByText(/Run Preview/)).not.toBeInTheDocument();
  });

  it('passes budget to validation call', async () => {
    await setupValidForm();
    await waitFor(() => expect(mockValidateAction).toHaveBeenCalled());
    const callArgs = mockValidateAction.mock.calls[0][0];
    expect(callArgs).toHaveProperty('budget', 50); // Default budget value
  });
});
