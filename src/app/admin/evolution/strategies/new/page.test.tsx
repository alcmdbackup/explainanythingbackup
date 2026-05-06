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

const mockGetLastUsedPrompt = jest.fn();
const mockGetDispatchPreview = jest.fn();
const mockGetArenaCount = jest.fn();
jest.mock('@evolution/services/strategyPreviewActions', () => ({
  getLastUsedPromptAction: (...args: unknown[]) => mockGetLastUsedPrompt(...args),
  getStrategyDispatchPreviewAction: (...args: unknown[]) => mockGetDispatchPreview(...args),
  getArenaCountForPromptAction: (...args: unknown[]) => mockGetArenaCount(...args),
  DEFAULT_SEED_CHARS: 8000,
}));

// Dispatch plan view is imported; don't need to mock it — component renders fine with
// the plans the server action returns.

import NewStrategyPage from './page';
import { toast } from 'sonner';

describe('NewStrategyPage', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockCreate.mockReset();
    mockGetLastUsedPrompt.mockReset();
    mockGetDispatchPreview.mockReset();
    mockGetArenaCount.mockReset();
    mockCreate.mockResolvedValue({ success: true, data: { id: 'test-strategy-id' } });
    // Default: no qualifying prompt — mirrors empty-DB staging
    mockGetLastUsedPrompt.mockResolvedValue({ success: true, data: null });
    mockGetDispatchPreview.mockResolvedValue({ success: true, data: { plan: [], arenaCount: 0, seedArticleChars: 8000, promptName: null } });
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
    expect(screen.getByText('$0.05')).toBeInTheDocument();
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
    expect(callArgs.budgetUsd).toBe(0.05);
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

  // ─── Bug 1 regression (20260421): sourceMode='pool' auto-defaults qualityCutoff ──

  it("pool-mode without touching cutoff-mode dropdown still emits qualityCutoff in payload", async () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    // Split evenly so percentages sum to 100. Default is 60/40 which already sums to 100,
    // but we call splitEvenly to produce 50/50 which is simpler to reason about.
    fireEvent.click(screen.getByText(/split evenly/i));

    // Add a third iteration so we have a non-locked generate row to configure as pool.
    fireEvent.click(screen.getByText(/\+ add iteration/i));
    fireEvent.click(screen.getByText(/split evenly/i));

    // Iteration #3 is generate (new iterations default to generate). Its
    // source-mode select has testid `source-mode-select-2` (0-indexed).
    const sourceSelect = screen.getByTestId('source-mode-select-2') as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: 'pool' } });

    // Deliberately DO NOT interact with `cutoff-mode-2` — this is the exact gesture that
    // used to drop qualityCutoff from the payload pre-fix. Also leave the value input
    // alone; updateIteration should have auto-defaulted it to 5.
    const cutoffValue = screen.getByTestId('cutoff-value-2') as HTMLInputElement;
    expect(cutoffValue.value).toBe('5');

    fireEvent.click(screen.getByText(/create strategy/i));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.iterationConfigs[2]).toEqual(
      expect.objectContaining({
        agentType: 'generate',
        sourceMode: 'pool',
        qualityCutoff: { mode: 'topN', value: 5 },
      }),
    );
  });

  it('pool-mode auto-default can be overridden to topPercent/30', async () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    fireEvent.click(screen.getByText(/split evenly/i));
    fireEvent.click(screen.getByText(/\+ add iteration/i));
    fireEvent.click(screen.getByText(/split evenly/i));

    const sourceSelect = screen.getByTestId('source-mode-select-2') as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: 'pool' } });

    const cutoffMode = screen.getByTestId('cutoff-mode-2') as HTMLSelectElement;
    fireEvent.change(cutoffMode, { target: { value: 'topPercent' } });
    const cutoffValue = screen.getByTestId('cutoff-value-2') as HTMLInputElement;
    fireEvent.change(cutoffValue, { target: { value: '30' } });

    fireEvent.click(screen.getByText(/create strategy/i));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    expect(mockCreate.mock.calls[0][0].iterationConfigs[2].qualityCutoff).toEqual({
      mode: 'topPercent',
      value: 30,
    });
  });

  // ─── First iteration must produce variants (generate or reflect_and_generate) ──────────────────
  // Shape A: the agent-type dropdown stays enabled for the first iteration, but the
  // Swiss option is disabled at the option level so users can't select it.

  it('disables only the Swiss option on the first iteration agent-type dropdown', () => {
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    const firstSelect = screen.getByTestId('agent-type-select-0') as HTMLSelectElement;
    expect(firstSelect).not.toBeDisabled();
    const swissOption = firstSelect.querySelector('option[value="swiss"]') as HTMLOptionElement;
    expect(swissOption).toBeTruthy();
    expect(swissOption.disabled).toBe(true);
  });

  // ─── Phase 3: smart-default prompt context ───────────────────

  it('shows empty-arena message when getLastUsedPromptAction returns null', async () => {
    mockGetLastUsedPrompt.mockResolvedValue({ success: true, data: null });
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    const context = await waitFor(() => screen.getByTestId('wizard-prompt-context'));
    expect(context.textContent).toMatch(/empty arena/i);
  });

  it('shows last-used prompt name + arena count when available', async () => {
    mockGetLastUsedPrompt.mockResolvedValue({
      success: true, data: { id: 'p-1', name: 'Federal Reserve', promptText: 'What is the Fed?' },
    });
    mockGetDispatchPreview.mockResolvedValue({
      success: true,
      data: {
        plan: [{
          iterIdx: 0, agentType: 'generate', iterBudgetUsd: 0.025, tactic: 'structural_transform',
          estPerAgent: { expected: { gen: 0.0012, rank: 0.003, total: 0.0042 }, upperBound: { gen: 0.0017, rank: 0.006, total: 0.0077 } },
          maxAffordable: { atExpected: 5, atUpperBound: 3 }, dispatchCount: 3,
          effectiveCap: 'budget', poolSizeAtStart: 494, parallelFloorUsd: 0,
        }],
        arenaCount: 494, seedArticleChars: 8000, promptName: 'Federal Reserve',
      },
    });

    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    // Advance the debounce timer so the preview fires.
    await waitFor(() => {
      const ctx = screen.getByTestId('wizard-prompt-context');
      expect(ctx.textContent).toMatch(/Federal Reserve/);
      expect(ctx.textContent).toMatch(/494/);
    }, { timeout: 3000 });
  });

  it('seed-chars input is user-editable and defaults to 8000', async () => {
    mockGetLastUsedPrompt.mockResolvedValue({ success: true, data: null });
    render(<NewStrategyPage />);
    fillStep1();
    fireEvent.click(screen.getByText(/next: configure iterations/i));

    const seedInput = await waitFor(() => screen.getByTestId('wizard-seed-chars') as HTMLInputElement);
    expect(seedInput.value).toBe('8000');

    fireEvent.change(seedInput, { target: { value: '12000' } });
    expect(seedInput.value).toBe('12000');
  });

  it('debounces dispatch-preview refresh by ~300ms (multiple rapid changes coalesce)', async () => {
    // Use fake timers to observe the debounce. A burst of 3 changes should result in only
    // one getStrategyDispatchPreviewAction call.
    jest.useFakeTimers();
    try {
      mockGetLastUsedPrompt.mockResolvedValue({ success: true, data: null });
      render(<NewStrategyPage />);
      fillStep1();
      fireEvent.click(screen.getByText(/next: configure iterations/i));

      mockGetDispatchPreview.mockClear();

      const seedInput = screen.getByTestId('wizard-seed-chars') as HTMLInputElement;
      fireEvent.change(seedInput, { target: { value: '9000' } });
      fireEvent.change(seedInput, { target: { value: '10000' } });
      fireEvent.change(seedInput, { target: { value: '11000' } });

      // Advance past the 300ms debounce window.
      jest.advanceTimersByTime(400);

      // Wait for any pending microtasks after timer advance.
      await Promise.resolve();

      // Exactly one refresh call after the burst (pre-burst calls may also exist, but
      // the three rapid changes should coalesce into ≤ 1 net new call).
      expect(mockGetDispatchPreview.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── Helpers ──────────────────────────────────────────────────

function fillStep1() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test Strategy' } });
  fireEvent.change(screen.getByLabelText('Generation Model'), { target: { value: 'qwen-2.5-7b-instruct' } });
  fireEvent.change(screen.getByLabelText('Judge Model'), { target: { value: 'qwen-2.5-7b-instruct' } });
}
