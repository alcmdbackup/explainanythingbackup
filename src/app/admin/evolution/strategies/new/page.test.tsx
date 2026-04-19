// Tests for the 2-step strategy creation wizard at /strategies/new.
// Covers step navigation, validation, iteration management, and form submission.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const mockCreate = jest.fn();
jest.mock('@evolution/services/strategyRegistryActions', () => ({
  createStrategyAction: (...args: unknown[]) => mockCreate(...args),
}));

import NewStrategyPage from './page';
import { toast } from 'sonner';

describe('NewStrategyPage', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({ success: true, data: { id: 'test-strategy-id' } });
  });

  // ─── Step 1: Config ──────────────────────────────────────

  it('renders step 1 by default with config fields', () => {
    render(<NewStrategyPage />);
    expect(screen.getByText('New Strategy')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Generation Model')).toBeInTheDocument();
    expect(screen.getByLabelText('Judge Model')).toBeInTheDocument();
    expect(screen.getByLabelText(/total budget/i)).toBeInTheDocument();
  });

  it('shows progress bar with two steps', () => {
    render(<NewStrategyPage />);
    expect(screen.getByText(/strategy config/i)).toBeInTheDocument();
    expect(screen.getByText(/iterations \+ submit/i)).toBeInTheDocument();
  });

  it('blocks step 1 progression with empty name', () => {
    render(<NewStrategyPage />);
    const nextBtn = screen.getByText(/next: configure iterations/i);
    fireEvent.click(nextBtn);
    expect(screen.getAllByText(/name is required/i).length).toBeGreaterThan(0);
    // Should still be on step 1
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  it('blocks step 1 progression without generation model', () => {
    render(<NewStrategyPage />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test' } });
    const nextBtn = screen.getByText(/next: configure iterations/i);
    fireEvent.click(nextBtn);
    expect(screen.getByText(/select a generation model/i)).toBeInTheDocument();
  });

  it('advances to step 2 when config is valid', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));
    // Should now be on step 2
    expect(screen.getByText(/split evenly/i)).toBeInTheDocument();
  });

  // ─── Step 2: Iterations ──────────────────────────────────

  it('shows default iterations (generate + swiss)', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    // Default: 2 iterations - use getAllByText since text may appear in multiple places
    expect(screen.getAllByText('#1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#2').length).toBeGreaterThan(0);
  });

  it('shows budget reference header on step 2', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    expect(screen.getByText('Total Budget')).toBeInTheDocument();
    expect(screen.getByText('$2.00')).toBeInTheDocument();
  });

  it('adds a new iteration', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    fireEvent.click(screen.getByText(/\+ add iteration/i));
    expect(screen.getByText('#3')).toBeInTheDocument();
  });

  it('removes an iteration', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    // Add one more, then remove one
    fireEvent.click(screen.getByText(/\+ add iteration/i));
    expect(screen.getByText('#3')).toBeInTheDocument();

    const removeButtons = screen.getAllByText(/remove/i);
    fireEvent.click(removeButtons[removeButtons.length - 1]!);
    expect(screen.queryByText('#3')).not.toBeInTheDocument();
  });

  it('split evenly distributes budget', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    fireEvent.click(screen.getByText(/split evenly/i));
    // 2 iterations: 50/50
    const percentInputs = screen.getAllByDisplayValue('50');
    expect(percentInputs.length).toBe(2);
  });

  it('shows allocation bar with percentage total', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    expect(screen.getByText(/budget allocation/i)).toBeInTheDocument();
    expect(screen.getByText(/100% \/ 100%/)).toBeInTheDocument();
  });

  it('shows validation error when percentages do not sum to 100', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    // Add a third iteration with 0% — total becomes 100 still but add to break it
    fireEvent.click(screen.getByText(/\+ add iteration/i));
    // Now total is 60 + 40 + 0 = 100, but let's change one
    const percentInputs = screen.getAllByRole('spinbutton');
    const firstPercent = percentInputs.find(el => (el as HTMLInputElement).value === '60');
    if (firstPercent) {
      fireEvent.change(firstPercent, { target: { value: '30' } });
    }

    expect(screen.getByText(/must sum to 100%/i)).toBeInTheDocument();
  });

  it('navigates back to step 1', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    fireEvent.click(screen.getByText(/^back$/i));
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });

  // ─── Submission ──────────────────────────────────────────

  it('submits and navigates to new strategy on success', async () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    fireEvent.click(screen.getByText(/create strategy/i));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.name).toBe('Test Strategy');
    expect(callArgs.generationModel).toBe('qwen-2.5-7b-instruct');
    expect(callArgs.judgeModel).toBe('qwen-2.5-7b-instruct');
    expect(callArgs.budgetUsd).toBe(2);
    expect(callArgs.iterationConfigs).toHaveLength(2);
    expect(callArgs.iterationConfigs[0].agentType).toBe('generate');
    expect(callArgs.iterationConfigs[1].agentType).toBe('swiss');

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/admin/evolution/strategies/test-strategy-id');
    });
    expect(toast.success).toHaveBeenCalledWith('Strategy "Test Strategy" created');
  });

  it('shows error toast on submission failure', async () => {
    mockCreate.mockResolvedValue({ success: false, error: { message: 'Oops' } });
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));
    fireEvent.click(screen.getByText(/create strategy/i));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Oops');
    });
  });

  // ─── First iteration locked to generate ──────────────────

  it('disables agent type dropdown for first iteration', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    const selects = screen.getAllByDisplayValue('Generate');
    // The first generate select should be disabled
    expect(selects[0]).toBeDisabled();
  });
});

// ─── Helpers ──────────────────────────────────────────────────

function fillStep1() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Strategy' } });
  fireEvent.change(screen.getByLabelText('Generation Model'), { target: { value: 'qwen-2.5-7b-instruct' } });
  fireEvent.change(screen.getByLabelText('Judge Model'), { target: { value: 'qwen-2.5-7b-instruct' } });
}
