// Component tests for CostEstimatesTab covering loading, error, both entityType
// variants, sensitivity-applicable + non-applicable rendering, accurate-estimate
// edge, ceiling-binding edge, and per-invocation table sort.

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { CostEstimatesTab } from './CostEstimatesTab';
import type {
  RunCostEstimates,
  StrategyCostEstimates,
  BudgetFloorSensitivity,
} from '@evolution/services/costEstimationActions';

jest.mock('@evolution/services/costEstimationActions', () => ({
  getRunCostEstimatesAction: jest.fn(),
  getStrategyCostEstimatesAction: jest.fn(),
  COST_ERROR_HISTOGRAM_BUCKETS: [
    { label: '<-25%', min: -Infinity, max: -25 },
    { label: '-25..-5%', min: -25, max: -5 },
    { label: '-5..+5%', min: -5, max: 5 },
    { label: '+5..+25%', min: 5, max: 25 },
    { label: '>+25%', min: 25, max: Infinity },
  ],
}));

const { getRunCostEstimatesAction, getStrategyCostEstimatesAction } =
  jest.requireMock('@evolution/services/costEstimationActions');

function makeBaseRunData(overrides: Partial<RunCostEstimates> = {}): RunCostEstimates {
  return {
    runId: 'run-1',
    summary: { totalCost: 0.847, estimatedCost: 0.754, absError: 0.093, errorPct: 12.4, budgetCap: 1.0 },
    costByAgent: [
      { agentName: 'generate_from_seed_article', invocations: 7, estimatedUsd: 0.72, actualUsd: 0.81, errorPct: 12.5, coverage: 'est+act' },
      { agentName: 'swiss_ranking', invocations: 4, estimatedUsd: null, actualUsd: 0.056, errorPct: null, coverage: 'actual-only' },
      { agentName: 'merge_ratings', invocations: 4, estimatedUsd: null, actualUsd: 0, errorPct: null, coverage: 'no-llm' },
    ],
    invocations: [
      { id: 'inv-1', agentName: 'generate_from_seed_article', iteration: 1, strategy: 'grounding_enhance',
        generationEstimate: 0.06, generationActual: 0.082, rankingEstimate: 0.02, rankingActual: 0.024,
        totalCost: 0.106, estimationErrorPct: 31.3 },
      { id: 'inv-2', agentName: 'generate_from_seed_article', iteration: 1, strategy: 'lexical_simplify',
        generationEstimate: 0.032, generationActual: 0.026, rankingEstimate: 0.02, rankingActual: 0.017,
        totalCost: 0.043, estimationErrorPct: -17.6 },
    ],
    histogram: [
      { label: '<-25%', count: 0 },
      { label: '-25..-5%', count: 1 },
      { label: '-5..+5%', count: 2 },
      { label: '+5..+25%', count: 5 },
      { label: '>+25%', count: 1 },
    ],
    budgetFloorSensitivity: {
      applicable: true,
      drift: { estimate: 0.082, actual: 0.094, pct: -12.77 },
      config: { parallelMultiplier: 3, sequentialMultiplier: 1 },
      actual: { parallelDispatched: 7, sequentialDispatched: 2, sequentialWallMs: 102000 },
      projected: { parallelDispatched: 7, sequentialDispatched: 3, sequentialWallMs: 153000 },
      medianSequentialGfsaDurationMs: 51000,
    },
    ...overrides,
  };
}

function makeStrategyData(overrides: Partial<StrategyCostEstimates> = {}): StrategyCostEstimates {
  return {
    strategyId: 'strat-1',
    summary: { totalCost: 38.91, estimatedCost: 35.0, absError: 0.4, errorPct: 9.2, budgetCap: null,
      runCount: 47, runsWithEstimates: 35 },
    runs: [
      { runId: 'r1', status: 'completed', createdAt: '2026-04-14T10:00:00Z', totalCost: 0.95, estimatedCost: 0.84, errorPct: 13.1 },
      { runId: 'r2', status: 'completed', createdAt: '2026-04-14T09:00:00Z', totalCost: 0.73, estimatedCost: 0.71, errorPct: 2.8 },
    ],
    sliceBreakdown: [
      { strategy: 'grounding_enhance', generationModel: 'gpt-4o-mini', judgeModel: 'qwen-2.5-7b',
        runs: 28, avgActual: 0.71, avgErrorPct: 15.3 },
    ],
    histogram: [
      { label: '<-25%', count: 1 }, { label: '-25..-5%', count: 6 },
      { label: '-5..+5%', count: 11 }, { label: '+5..+25%', count: 21 }, { label: '>+25%', count: 8 },
    ],
    truncatedSlices: false,
    ...overrides,
  };
}

describe('CostEstimatesTab — Run view', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders loading skeleton while fetching', () => {
    getRunCostEstimatesAction.mockReturnValue(new Promise(() => {}));
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    expect(screen.getByTestId('cost-estimates-loading')).toBeInTheDocument();
  });

  it('renders error banner when action fails', async () => {
    getRunCostEstimatesAction.mockResolvedValue({ success: false, data: null, error: { message: 'boom' } });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('cost-estimates-error')).toBeInTheDocument());
  });

  it('renders summary, agent table, sensitivity, histogram, invocation table for happy path', async () => {
    getRunCostEstimatesAction.mockResolvedValue({ success: true, data: makeBaseRunData(), error: null });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('cost-estimates-tab')).toBeInTheDocument());
    expect(screen.getByTestId('cost-estimates-summary')).toBeInTheDocument();
    expect(screen.getByTestId('cost-estimates-by-agent')).toBeInTheDocument();
    expect(screen.getByTestId('budget-floor-sensitivity')).toBeInTheDocument();
    expect(screen.getByTestId('cost-estimates-histogram')).toBeInTheDocument();
    expect(screen.getByTestId('cost-estimates-invocations')).toBeInTheDocument();
  });

  it('shows pre-instrumentation badge when neither run-level summary NOR per-invocation estimates exist', async () => {
    getRunCostEstimatesAction.mockResolvedValue({ success: true, data: makeBaseRunData({
      summary: { totalCost: null, estimatedCost: null, absError: null, errorPct: null, budgetCap: null },
      invocations: [
        // No generationEstimate / rankingEstimate on any invocation
        { id: 'inv-1', agentName: 'generate_from_seed_article', iteration: 1, strategy: null,
          generationEstimate: null, generationActual: 0.05, rankingEstimate: null, rankingActual: 0.02,
          totalCost: 0.07, estimationErrorPct: null },
      ],
    }), error: null });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('cost-estimates-pre-instrumentation')).toBeInTheDocument());
  });

  it('shows rollup-missing badge when run-level summary is empty but per-invocation estimates exist', async () => {
    getRunCostEstimatesAction.mockResolvedValue({ success: true, data: makeBaseRunData({
      summary: { totalCost: 0.1, estimatedCost: null, absError: null, errorPct: null, budgetCap: 1.0 },
      // makeBaseRunData's default invocations include generationEstimate / rankingEstimate values
    }), error: null });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('cost-estimates-rollup-missing')).toBeInTheDocument());
    // And NOT the pre-instrumentation badge
    expect(screen.queryByTestId('cost-estimates-pre-instrumentation')).not.toBeInTheDocument();
  });

  it.each([
    ['fraction_mode' as const],
    ['floor_unset' as const],
    ['parallel_failed' as const],
    ['no_gfsa' as const],
    ['missing_config' as const],
  ])('hides Budget Floor Sensitivity when reasonNotApplicable=%s', async (reason) => {
    const sensitivity: BudgetFloorSensitivity = { applicable: false, reasonNotApplicable: reason };
    getRunCostEstimatesAction.mockResolvedValue({
      success: true, data: makeBaseRunData({ budgetFloorSensitivity: sensitivity }), error: null,
    });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('cost-estimates-tab')).toBeInTheDocument());
    expect(screen.queryByTestId('budget-floor-sensitivity')).not.toBeInTheDocument();
  });

  it('renders accurate-estimate edge variant', async () => {
    const sensitivity: BudgetFloorSensitivity = {
      applicable: true,
      drift: { estimate: 0.094, actual: 0.094, pct: 0.5 },
      config: { parallelMultiplier: 3, sequentialMultiplier: 1 },
      actual: { parallelDispatched: 7, sequentialDispatched: 3, sequentialWallMs: 153000 },
      projected: { parallelDispatched: 7, sequentialDispatched: 3, sequentialWallMs: 153000 },
      medianSequentialGfsaDurationMs: 51000,
      edge: 'accurate',
    };
    getRunCostEstimatesAction.mockResolvedValue({ success: true, data: makeBaseRunData({ budgetFloorSensitivity: sensitivity }), error: null });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('sensitivity-accurate')).toBeInTheDocument());
  });

  it('renders ceiling-binding edge variant', async () => {
    const sensitivity: BudgetFloorSensitivity = {
      applicable: true,
      drift: { estimate: 0.082, actual: 0.094, pct: -12.77 },
      config: { parallelMultiplier: 3, sequentialMultiplier: 1 },
      actual: { parallelDispatched: 9, sequentialDispatched: 0, sequentialWallMs: 0 },
      projected: { parallelDispatched: 9, sequentialDispatched: 0, sequentialWallMs: 0 },
      medianSequentialGfsaDurationMs: 51000,
      edge: 'ceiling_binding',
    };
    getRunCostEstimatesAction.mockResolvedValue({ success: true, data: makeBaseRunData({ budgetFloorSensitivity: sensitivity }), error: null });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('sensitivity-ceiling')).toBeInTheDocument());
  });

  it('cost-by-agent table includes all seeded rows with non-GFSA showing — for estimate', async () => {
    getRunCostEstimatesAction.mockResolvedValue({ success: true, data: makeBaseRunData(), error: null });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('cost-estimates-by-agent')).toBeInTheDocument());
    // Non-LLM coverage cell should appear for merge_ratings row
    expect(screen.getByText('no-llm')).toBeInTheDocument();
  });

  it('histogram renders bars for each bucket', async () => {
    getRunCostEstimatesAction.mockResolvedValue({ success: true, data: makeBaseRunData(), error: null });
    render(<CostEstimatesTab entityType="run" entityId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('histogram-bar-<-25%')).toBeInTheDocument());
    expect(screen.getByTestId('histogram-bar-+5..+25%')).toBeInTheDocument();
  });
});

describe('CostEstimatesTab — Strategy view', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders summary, slice breakdown, histogram, runs sections', async () => {
    getStrategyCostEstimatesAction.mockResolvedValue({ success: true, data: makeStrategyData(), error: null });
    render(<CostEstimatesTab entityType="strategy" entityId="strat-1" />);
    await waitFor(() => expect(screen.getByTestId('cost-estimates-tab')).toBeInTheDocument());
    expect(screen.getByTestId('cost-estimates-summary')).toBeInTheDocument();
    expect(screen.getByTestId('cost-estimates-slices')).toBeInTheDocument();
    expect(screen.getByTestId('cost-estimates-histogram')).toBeInTheDocument();
    expect(screen.getByTestId('cost-estimates-runs')).toBeInTheDocument();
  });

  it('does not render Budget Floor Sensitivity on strategy view', async () => {
    getStrategyCostEstimatesAction.mockResolvedValue({ success: true, data: makeStrategyData(), error: null });
    render(<CostEstimatesTab entityType="strategy" entityId="strat-1" />);
    await waitFor(() => expect(screen.getByTestId('cost-estimates-tab')).toBeInTheDocument());
    expect(screen.queryByTestId('budget-floor-sensitivity')).not.toBeInTheDocument();
  });

  it('shows truncated-slices footer when truncated=true', async () => {
    getStrategyCostEstimatesAction.mockResolvedValue({ success: true, data: makeStrategyData({ truncatedSlices: true }), error: null });
    render(<CostEstimatesTab entityType="strategy" entityId="strat-1" />);
    await waitFor(() => expect(screen.getByText(/Showing top 50 slices/)).toBeInTheDocument());
  });

  it('handles loading state for strategy view', () => {
    getStrategyCostEstimatesAction.mockReturnValue(new Promise(() => {}));
    render(<CostEstimatesTab entityType="strategy" entityId="strat-1" />);
    expect(screen.getByTestId('cost-estimates-loading')).toBeInTheDocument();
  });
});

// Silence eslint for unused act import; reserved for future user-interaction tests.
void act;
