// Smoke test for the /edit picker (improvements_to_edit_page_evolution_20260630 Phase 4).
// Focus: the [Show config] button contract — clicking it opens the modal WITHOUT
// changing the selected strategy (stopPropagation invariant).

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditForm from './EditForm';

// Mock server action shape returned by publicAction wrapper.
jest.mock('./publicEditActions', () => ({
  submitPublicEditAction: jest.fn(async () => ({ success: true, data: { runId: 'fake' }, error: null })),
}));
jest.mock('@evolution/services/strategyRegistryActions', () => ({
  getPublicStrategyConfigAction: jest.fn(async () => ({
    success: true,
    data: {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'qwen-2.5-7b-instruct',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
      budgetUsd: 0.05,
    },
    error: null,
  })),
}));
// Mock StrategyConfigDisplay as a passthrough — the actual render is covered by its own test.
jest.mock('@/components/strategy/StrategyConfigDisplay', () => ({
  StrategyConfigDisplay: () => <div data-testid="strategy-config-display-mock" />,
}));
// Mock next/navigation router — needed for the useRouter() import in EditForm.
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const STRATEGY_A = {
  id: 'strat-a',
  name: 'Alpha',
  label: 'Alpha Strategy',
  description: 'Fast rewrite',
  generationModel: 'gpt-4.1-mini',
  judgeModel: 'qwen',
  iterationCount: 1,
  budgetUsd: 0.05,
};
const STRATEGY_B = {
  id: 'strat-b',
  name: 'Beta',
  label: 'Beta Strategy',
  description: 'Deep rewrite',
  generationModel: 'gpt-4o',
  judgeModel: 'qwen',
  iterationCount: 3,
  budgetUsd: 0.50,
};

describe('EditForm', () => {
  it('shows empty-state slot when no strategies are provided', () => {
    render(<EditForm initialStrategies={[]} />);
    expect(screen.getByTestId('edit-form-no-strategies')).toBeTruthy();
  });

  it('renders the combobox with hydration-proof testid', () => {
    render(<EditForm initialStrategies={[STRATEGY_A, STRATEGY_B]} />);
    expect(screen.getByTestId('strategy-combobox-trigger')).toBeTruthy();
    expect(screen.getByTestId('strategy-combobox-hydrated')).toBeTruthy();
  });

  it('shows budget-warning badge for strategy with budgetUsd > $0.10', () => {
    render(<EditForm initialStrategies={[STRATEGY_A, STRATEGY_B]} />);
    // Open the combobox to make rows appear.
    fireEvent.focus(screen.getByTestId('strategy-combobox-trigger'));
    // STRATEGY_B has budgetUsd=0.50 → warning present; STRATEGY_A has 0.05 → warning absent.
    expect(screen.queryByTestId(`strategy-option-budget-warning-${STRATEGY_B.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`strategy-option-budget-warning-${STRATEGY_A.id}`)).toBeNull();
  });

  it('[Show config] button opens the config modal WITHOUT selecting the strategy', async () => {
    render(<EditForm initialStrategies={[STRATEGY_A, STRATEGY_B]} />);
    fireEvent.focus(screen.getByTestId('strategy-combobox-trigger'));

    // Default selection is STRATEGY_A (index 0). Click Show config on STRATEGY_B.
    const showConfigB = screen.getByTestId(`strategy-option-show-config-${STRATEGY_B.id}`);
    fireEvent.mouseDown(showConfigB);

    // Modal opens.
    await waitFor(() => {
      expect(screen.queryByTestId('strategy-config-modal')).toBeTruthy();
    });

    // The combobox trigger should still show STRATEGY_A's label (selection unchanged).
    const trigger = screen.getByTestId('strategy-combobox-trigger') as HTMLInputElement;
    // When combobox is open, input shows query (empty); when closed, shows selected label.
    // The important invariant is that selection state is unchanged — the config modal is B, but
    // the picker's underlying `strategyId` state is still A. We can verify this indirectly by
    // checking the modal is opened for B, and the selected-strategy budget-warning did NOT
    // switch to B's warning (STRATEGY_A has no over-budget warning).
    expect(screen.queryByTestId('selected-strategy-budget-warning')).toBeNull();
    expect(trigger).toBeTruthy();
  });
});
