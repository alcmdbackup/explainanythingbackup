// Tests for BudgetFloorsField composite form field.
// Exercises mode switching, value entry, cross-field validation, and cost-preview fetch.
//
// The component is currently defined inside strategies/page.tsx as a module-local
// function. To test it in isolation, we import the page module — the component
// is not exported, so these tests exercise it via the exported buildCreateFields.

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// Mock the server action module BEFORE importing the page component.
jest.mock('@evolution/services/strategyPreviewActions', () => ({
  estimateAgentCostPreviewAction: jest.fn(),
}));

// Also mock the other services the page imports so they don't hit the network.
jest.mock('@evolution/services/strategyRegistryActions', () => ({
  listStrategiesAction: jest.fn().mockResolvedValue({ success: true, data: { items: [], total: 0 } }),
  createStrategyAction: jest.fn(),
  updateStrategyAction: jest.fn(),
  cloneStrategyAction: jest.fn(),
}));

jest.mock('@evolution/services/metricsActions', () => ({
  getBatchMetricsAction: jest.fn().mockResolvedValue({ success: true, data: {} }),
}));

jest.mock('@evolution/services/entityActions', () => ({
  executeEntityAction: jest.fn(),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// The BudgetFloorsField component is not exported, so we import the page and
// navigate into its internal buildCreateFields() to get access to the render function.
import { estimateAgentCostPreviewAction } from '@evolution/services/strategyPreviewActions';

// Re-import buildCreateFields via an internal module hack. Since the component
// is defined in the same file as the default export but not re-exported, we
// rely on the file's top-level side effects still making the component reachable
// via the test-only render helper below.

// Test helper: extract the BudgetFloorsField render function from the buildCreateFields array.
import StrategiesPage from './page';

// Force the page component to mount so buildCreateFields gets used in the render tree.
// We spy on the form dialog's fields to extract the render fn.
// Simpler approach: just render the page and interact with the rendered form.

describe('BudgetFloorsField rendering', () => {
  const mockEstimate = estimateAgentCostPreviewAction as jest.MockedFunction<typeof estimateAgentCostPreviewAction>;

  beforeEach(() => {
    mockEstimate.mockReset();
    mockEstimate.mockResolvedValue({
      success: true,
      data: {
        estimatedAgentCostUsd: 0.00812,
        assumptions: {
          seedArticleChars: 5000,
          strategy: 'grounding_enhance',
          comparisonsUsed: 15,
        },
      },
    } as Awaited<ReturnType<typeof estimateAgentCostPreviewAction>>);
  });

  it('renders default fraction mode on fresh form', async () => {
    render(<StrategiesPage />);
    // Open the "New Strategy" dialog
    const newButton = await screen.findByText(/new strategy/i);
    fireEvent.click(newButton);

    // Budget floors field should render with fraction mode
    const modeDropdown = await screen.findByTestId('budget-floors-mode');
    expect(modeDropdown).toHaveValue('fraction');
    expect(screen.getByTestId('budget-floors-parallel')).toBeInTheDocument();
    expect(screen.getByTestId('budget-floors-sequential')).toBeInTheDocument();
  });

  it('switches to agent-multiple mode, fetches preview, shows cost estimate', async () => {
    render(<StrategiesPage />);
    const newButton = await screen.findByText(/new strategy/i);
    fireEvent.click(newButton);

    // Select generation + judge models (required for preview to load)
    const genModel = await screen.findByLabelText(/generation model/i);
    fireEvent.change(genModel, { target: { value: 'qwen-2.5-7b-instruct' } });
    const judgeModel = await screen.findByLabelText(/judge model/i);
    fireEvent.change(judgeModel, { target: { value: 'qwen-2.5-7b-instruct' } });

    // Switch budget floors mode to agent-multiple
    const modeDropdown = await screen.findByTestId('budget-floors-mode');
    fireEvent.change(modeDropdown, { target: { value: 'agentMultiple' } });
    expect(modeDropdown).toHaveValue('agentMultiple');

    // Preview container should appear
    const preview = await screen.findByTestId('budget-floors-preview');
    expect(preview).toBeInTheDocument();

    // Wait for debounced fetch + render
    await waitFor(() => {
      expect(mockEstimate).toHaveBeenCalled();
    }, { timeout: 2000 });

    // After resolution, preview should show the estimated cost
    await waitFor(() => {
      expect(preview.textContent).toMatch(/\$0\.0081/);
    }, { timeout: 2000 });

    // And the "Based on" assumption chip should be visible
    expect(preview.textContent).toMatch(/grounding_enhance/);
    expect(preview.textContent).toMatch(/15 ranking comparisons/);
  });

  it('enforces sequential ≤ parallel validation on submit', async () => {
    render(<StrategiesPage />);
    const newButton = await screen.findByText(/new strategy/i);
    fireEvent.click(newButton);

    // Enter values where sequential > parallel (ordering violation)
    const parallelInput = await screen.findByTestId('budget-floors-parallel');
    const sequentialInput = await screen.findByTestId('budget-floors-sequential');
    fireEvent.change(parallelInput, { target: { value: '0.2' } });
    fireEvent.change(sequentialInput, { target: { value: '0.4' } });

    // Inline error should appear
    await waitFor(() => {
      expect(screen.getByTestId('budget-floors-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('budget-floors-error').textContent).toMatch(/must be ≤ parallel/i);
  });

  it('does NOT fetch preview when models are unset (fraction mode)', async () => {
    render(<StrategiesPage />);
    const newButton = await screen.findByText(/new strategy/i);
    fireEvent.click(newButton);

    // Fraction mode doesn't need preview — ensure no server action call
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400)); // wait past the debounce window
    });
    expect(mockEstimate).not.toHaveBeenCalled();
  });
});
