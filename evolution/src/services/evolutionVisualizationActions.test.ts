// Tests for evolution visualization server actions: invocations-based timeline, variant queries, and cost attribution.

import {
  getEvolutionRunTimelineAction,
  getEvolutionRunBudgetAction,
  buildVariantsFromCheckpoint,
  getAgentInvocationDetailAction,
  getIterationInvocationsAction,
  getAgentInvocationsForRunAction,
  getInvocationFullDetailAction,
  listInvocationsAction,
  type TimelineData,
  type BudgetData,
  type InvocationFullDetail,
} from './evolutionVisualizationActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

/** Build a Supabase mock where every method chains and terminals resolve. */
function createChainMock() {
  const mock: Record<string, jest.Mock> = {};
  const chain = () => mock;
  for (const m of ['from', 'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'like', 'ilike', 'in', 'is',
    'order', 'limit', 'range', 'single', 'maybeSingle']) {
    mock[m] = jest.fn(chain);
  }
  return mock;
}

describe('getEvolutionRunTimelineAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  /** Helper: mock single invocations query (the only query timeline uses in V2). */
  function mockInvocationsQuery(mock: Record<string, jest.Mock>, invocations: unknown[]) {
    // V2 timeline: from().select().eq().order().order() — second order is terminal
    let orderCount = 0;
    mock.order.mockImplementation(() => {
      orderCount++;
      if (orderCount === 2) {
        return Promise.resolve({ data: invocations, error: null });
      }
      return mock;
    });
  }

  it('returns multiple agents per iteration from invocations', async () => {
    const mock = createChainMock();

    mockInvocationsQuery(mock, [
      {
        id: 'inv-1', iteration: 0, agent_name: 'generation', cost_usd: 0.01,
        execution_order: 0, execution_detail: {
          _diffMetrics: { variantsAdded: 1, matchesPlayed: 0, newVariantIds: ['v-a'], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
      {
        id: 'inv-2', iteration: 0, agent_name: 'calibration', cost_usd: 0.005,
        execution_order: 1, execution_detail: {
          _diffMetrics: { variantsAdded: 0, matchesPlayed: 3, newVariantIds: [], eloChanges: { 'v-a': 20 }, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
      {
        id: 'inv-3', iteration: 0, agent_name: 'proximity', cost_usd: 0.002,
        execution_order: 2, execution_detail: {
          _diffMetrics: { variantsAdded: 0, matchesPlayed: 0, newVariantIds: [], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: 0.75, metaFeedbackPopulated: false },
        },
      },
    ]);

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.iterations).toHaveLength(1);
    expect(result.data!.iterations[0].agents).toHaveLength(3);
    expect(result.data!.iterations[0].agents.map(a => a.name)).toEqual(['generation', 'calibration', 'proximity']);
  });

  it('reads variantsAdded from invocation _diffMetrics', async () => {
    const mock = createChainMock();

    mockInvocationsQuery(mock, [
      {
        id: 'inv-1', iteration: 0, agent_name: 'generation', cost_usd: 0.01,
        execution_order: 0, execution_detail: {
          _diffMetrics: { variantsAdded: 1, matchesPlayed: 0, newVariantIds: ['variant-a'], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
      {
        id: 'inv-2', iteration: 0, agent_name: 'evolution', cost_usd: 0.02,
        execution_order: 1, execution_detail: {
          _diffMetrics: { variantsAdded: 1, matchesPlayed: 0, newVariantIds: ['variant-b'], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
    ]);

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const agents = result.data!.iterations[0].agents;

    expect(agents[0].variantsAdded).toBe(1);
    expect(agents[0].newVariantIds).toEqual(['variant-a']);

    expect(agents[1].variantsAdded).toBe(1);
    expect(agents[1].newVariantIds).toEqual(['variant-b']);
  });

  it('reads matchesPlayed from invocation _diffMetrics', async () => {
    const mock = createChainMock();

    mockInvocationsQuery(mock, [
      {
        id: 'inv-1', iteration: 0, agent_name: 'calibration', cost_usd: 0.005,
        execution_order: 0, execution_detail: {
          _diffMetrics: { variantsAdded: 0, matchesPlayed: 1, newVariantIds: [], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
      {
        id: 'inv-2', iteration: 0, agent_name: 'tournament', cost_usd: 0.01,
        execution_order: 1, execution_detail: {
          _diffMetrics: { variantsAdded: 0, matchesPlayed: 1, newVariantIds: [], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
    ]);

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const agents = result.data!.iterations[0].agents;

    expect(agents[0].matchesPlayed).toBe(1);
    expect(agents[1].matchesPlayed).toBe(1);
  });

  it('reads eloChanges from invocation _diffMetrics', async () => {
    const mock = createChainMock();

    mockInvocationsQuery(mock, [
      {
        id: 'inv-1', iteration: 0, agent_name: 'calibration', cost_usd: 0.005,
        execution_order: 0, execution_detail: {
          _diffMetrics: { variantsAdded: 0, matchesPlayed: 0, newVariantIds: [], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
      {
        id: 'inv-2', iteration: 0, agent_name: 'tournament', cost_usd: 0.01,
        execution_order: 1, execution_detail: {
          _diffMetrics: { variantsAdded: 0, matchesPlayed: 2, newVariantIds: [], eloChanges: { 'a': 50, 'b': -50 }, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
    ]);

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const agents = result.data!.iterations[0].agents;

    expect(agents[1].eloChanges).toEqual({ 'a': 50, 'b': -50 });
  });

  it('populates iteration totals correctly', async () => {
    const mock = createChainMock();

    mockInvocationsQuery(mock, [
      {
        id: 'inv-1', iteration: 0, agent_name: 'generation', cost_usd: 0.01,
        execution_order: 0, execution_detail: {
          _diffMetrics: { variantsAdded: 1, matchesPlayed: 0, newVariantIds: ['v-a'], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
      {
        id: 'inv-2', iteration: 0, agent_name: 'evolution', cost_usd: 0.02,
        execution_order: 1, execution_detail: {
          _diffMetrics: { variantsAdded: 1, matchesPlayed: 0, newVariantIds: ['v-b'], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
    ]);

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const iter = result.data!.iterations[0];

    expect(iter.totalVariantsAdded).toBe(2);
    expect(iter.totalCostUsd).toBeCloseTo(0.03, 4);
  });

  it('returns error for invalid run ID format', async () => {
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
    const result = await getEvolutionRunTimelineAction('not-a-uuid');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid run ID');
  });

  it('skips iteration_complete synthetic agents from invocations', async () => {
    const mock = createChainMock();

    mockInvocationsQuery(mock, [
      {
        id: 'inv-1', iteration: 0, agent_name: 'generation', cost_usd: 0.01,
        execution_order: 0, execution_detail: {
          _diffMetrics: { variantsAdded: 1, matchesPlayed: 0, newVariantIds: ['v-a'], eloChanges: {}, critiquesAdded: 0, diversityScoreAfter: null, metaFeedbackPopulated: false },
        },
      },
      {
        id: 'inv-2', iteration: 0, agent_name: 'calibration', cost_usd: 0.005,
        execution_order: 1, execution_detail: null,      },
      {
        id: 'inv-3', iteration: 0, agent_name: 'iteration_complete', cost_usd: 0,
        execution_order: 2, execution_detail: null,      },
    ]);

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    expect(result.data!.iterations).toHaveLength(1);
    const agents = result.data!.iterations[0].agents;
    expect(agents).toHaveLength(2);
    expect(agents.map(a => a.name)).toEqual(['generation', 'calibration']);
    expect(agents[0].variantsAdded).toBe(1);
    expect(agents[0].costUsd).toBeCloseTo(0.01);
    expect(agents[1].variantsAdded).toBe(0);
    expect(agents[1].costUsd).toBeCloseTo(0.005);
  });

  it('filters out iteration_complete when mixed with real agents', async () => {
    const mock = createChainMock();

    mockInvocationsQuery(mock, [
      {
        id: 'inv-1', iteration: 0, agent_name: 'generation', cost_usd: 0.01,
        execution_order: 0, execution_detail: null,      },
      {
        id: 'inv-2', iteration: 0, agent_name: 'iteration_complete', cost_usd: 0,
        execution_order: 1, execution_detail: null,      },
    ]);

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const agents = result.data!.iterations[0].agents;
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('generation');
  });

  it('handles empty invocations gracefully', async () => {
    const mock = createChainMock();

    mockInvocationsQuery(mock, []);

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    expect(result.data!.iterations).toHaveLength(0);
  });
});

describe('getEvolutionRunBudgetAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns estimate and prediction when present on run row', async () => {
    const mock = createChainMock();
    const mockEstimate = {
      totalUsd: 1.50,
      perAgent: { generation: 0.8, calibration: 0.4, evolution: 0.3 },
      perIteration: 0.5,
      confidence: 'high' as const,
    };
    const mockPrediction = {
      estimatedUsd: 1.50,
      actualUsd: 1.35,
      deltaUsd: -0.15,
      deltaPercent: -10,
      confidence: 'high' as const,
      perAgent: {
        generation: { estimated: 0.8, actual: 0.7 },
        calibration: { estimated: 0.4, actual: 0.35 },
        evolution: { estimated: 0.3, actual: 0.3 },
      },
    };

    mock.single.mockResolvedValue({
      data: {
        budget_cap_usd: 5,
        cost_estimate_detail: mockEstimate,
        cost_prediction: mockPrediction,
      },
      error: null,
    });

    // Invocations query (order is terminal on 2nd call)
    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      if (queryCount === 2) {
        return Promise.resolve({
          data: [
            { agent_name: 'generation', cost_usd: 0.7, iteration: 0, execution_order: 0 },
            { agent_name: 'calibration', cost_usd: 0.35, iteration: 0, execution_order: 1 },
          ],
          error: null,
        });
      }
      return mock;
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunBudgetAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    expect(result.data!.estimate).toEqual(mockEstimate);
    expect(result.data!.prediction).toEqual(mockPrediction);
    expect(result.data!.agentBreakdown).toHaveLength(2);
    expect(result.data!.cumulativeBurn).toHaveLength(2);
  });

  it('returns null estimate and prediction when not present', async () => {
    const mock = createChainMock();

    mock.single.mockResolvedValue({
      data: {
        budget_cap_usd: 5,
        cost_estimate_detail: null,
        cost_prediction: null,
      },
      error: null,
    });

    // Empty invocations
    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      if (queryCount === 2) {
        return Promise.resolve({ data: [], error: null });
      }
      return mock;
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunBudgetAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    expect(result.data!.estimate).toBeNull();
    expect(result.data!.prediction).toBeNull();
    expect(result.data!.agentBreakdown).toHaveLength(0);
    expect(result.data!.cumulativeBurn).toHaveLength(0);
  });

  it('rejects invalid run ID', async () => {
    const result = await getEvolutionRunBudgetAction('not-a-uuid');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid run ID');
  });

  it('returns runStatus from the run row', async () => {
    const mock = createChainMock();

    mock.single.mockResolvedValue({
      data: {
        started_at: '2026-01-01T00:00:00Z',
        completed_at: null,
        budget_cap_usd: 5,
        cost_estimate_detail: null,
        cost_prediction: null,
        config: null,
        status: 'running',
      },
      error: null,
    });

    mock.lte.mockResolvedValue({ data: [], error: null });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunBudgetAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    expect(result.data!.runStatus).toBe('running');
  });

  it('returns empty agentBudgetCaps when config is null', async () => {
    const mock = createChainMock();

    mock.single.mockResolvedValue({
      data: {
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T01:00:00Z',
        budget_cap_usd: 5,
        cost_estimate_detail: null,
        cost_prediction: null,
        config: null,
        status: 'completed',
      },
      error: null,
    });

    mock.lte.mockResolvedValue({ data: [], error: null });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunBudgetAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    expect(result.data!.agentBudgetCaps).toEqual({});
    expect(result.data!.runStatus).toBe('completed');
  });
});

// ─── buildVariantsFromCheckpoint ─────────────────────────────────

describe('buildVariantsFromCheckpoint', () => {
  const RUN_ID = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * V2: buildVariantsFromCheckpoint does Promise.all with:
   *  1. evolution_variants query: from().select().eq().order() — order is terminal
   *  2. evolution_runs query: from().select().eq().single() — single is terminal
   */
  function mockVariantAndRunQueries(
    mock: Record<string, jest.Mock>,
    variantRows: unknown[],
    runRow: { explanation_id: number | null },
  ) {
    mock.order.mockResolvedValueOnce({ data: variantRows, error: null });
    mock.single.mockResolvedValueOnce({ data: runRow, error: null });
  }

  it('maps evolution_variants rows to EvolutionVariant shape correctly', async () => {
    const mock = createChainMock();
    const now = '2023-11-14T22:13:20.000Z';

    mockVariantAndRunQueries(mock, [
      {
        id: 'v-1', run_id: RUN_ID, explanation_id: 42,
        variant_content: 'Hello world', elo_score: 1450,
        generation: 2, agent_name: 'evolution', match_count: 5,
        is_winner: false, created_at: now,
      },
    ], { explanation_id: 42 });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    const v = result.data![0];
    expect(v.id).toBe('v-1');
    expect(v.run_id).toBe(RUN_ID);
    expect(v.explanation_id).toBe(42);
    expect(v.variant_content).toBe('Hello world');
    expect(v.generation).toBe(2);
    expect(v.agent_name).toBe('evolution');
    expect(v.match_count).toBe(5);
    expect(v.is_winner).toBe(false);
    expect(v.elo_score).toBe(1450);
    expect(v.created_at).toBe(now);
  });

  it('uses run explanation_id as fallback when variant has none', async () => {
    const mock = createChainMock();

    mockVariantAndRunQueries(mock, [
      {
        id: 'v-1', run_id: RUN_ID, explanation_id: null,
        variant_content: 'Text', elo_score: 1350,
        generation: 0, agent_name: 'generation', match_count: 0,
        is_winner: false, created_at: '2026-01-01T00:00:00Z',
      },
    ], { explanation_id: 99 });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data![0].explanation_id).toBe(99);
  });

  it('returns empty array when no variants exist', async () => {
    const mock = createChainMock();

    mockVariantAndRunQueries(mock, [], { explanation_id: 1 });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('preserves elo_score order from DB (descending)', async () => {
    const mock = createChainMock();

    mockVariantAndRunQueries(mock, [
      { id: 'v-b', run_id: RUN_ID, explanation_id: null, variant_content: 'B', elo_score: 1400, generation: 0, agent_name: 'generation', match_count: 3, is_winner: false, created_at: '2026-01-01' },
      { id: 'v-a', run_id: RUN_ID, explanation_id: null, variant_content: 'A', elo_score: 1100, generation: 0, agent_name: 'generation', match_count: 2, is_winner: false, created_at: '2026-01-01' },
    ], { explanation_id: null });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data![0].elo_score).toBe(1400);
    expect(result.data![1].elo_score).toBe(1100);
  });

  it('maps is_winner from DB rows', async () => {
    const mock = createChainMock();

    mockVariantAndRunQueries(mock, [
      { id: 'v-a', run_id: RUN_ID, explanation_id: null, variant_content: 'A', elo_score: 1300, generation: 0, agent_name: 'generation', match_count: 0, is_winner: true, created_at: '2026-01-01' },
      { id: 'v-b', run_id: RUN_ID, explanation_id: null, variant_content: 'B', elo_score: 1200, generation: 0, agent_name: 'generation', match_count: 0, is_winner: false, created_at: '2026-01-01' },
    ], { explanation_id: null });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data![0].is_winner).toBe(true);
    expect(result.data![1].is_winner).toBe(false);
  });

  it('defaults elo_score to 1200 and match_count to 0 when null', async () => {
    const mock = createChainMock();

    mockVariantAndRunQueries(mock, [
      { id: 'v-no-data', run_id: RUN_ID, explanation_id: null, variant_content: 'Text', elo_score: null, generation: 0, agent_name: 'generation', match_count: null, is_winner: false, created_at: '2026-01-01' },
    ], { explanation_id: null });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data![0].elo_score).toBe(1200);
    expect(result.data![0].match_count).toBe(0);
  });
});

const VALID_RUN_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('getAgentInvocationDetailAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns execution detail when invocation exists', async () => {
    const mock = createChainMock();
    const detail = { detailType: 'proximity', totalCost: 0.002, newEntrants: 3, existingVariants: 5, diversityScore: 0.8, totalPairsComputed: 10 };
    mock.single.mockResolvedValue({ data: { execution_detail: detail }, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getAgentInvocationDetailAction(VALID_RUN_ID, 0, 'proximity');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(detail);
  });

  it('returns null when no invocation row exists (PGRST116)', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'No rows' } });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getAgentInvocationDetailAction(VALID_RUN_ID, 0, 'generation');
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('returns null when execution_detail has no detailType', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValue({ data: { execution_detail: {} }, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getAgentInvocationDetailAction(VALID_RUN_ID, 0, 'generation');
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('rejects invalid run ID', async () => {
    const result = await getAgentInvocationDetailAction('not-a-uuid', 0, 'generation');
    expect(result.success).toBe(false);
  });
});

describe('getIterationInvocationsAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns invocation rows for an iteration', async () => {
    const mock = createChainMock();
    const rows = [
      { id: 'inv-1', run_id: VALID_RUN_ID, iteration: 0, agent_name: 'generation', execution_order: 0, success: true, cost_usd: 0.01, skipped: false, execution_detail: null },
      { id: 'inv-2', run_id: VALID_RUN_ID, iteration: 0, agent_name: 'calibration', execution_order: 1, success: true, cost_usd: 0.005, skipped: false, execution_detail: null },
    ];
    mock.order.mockResolvedValue({ data: rows, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getIterationInvocationsAction(VALID_RUN_ID, 0);
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data![0].agent_name).toBe('generation');
  });

  it('returns empty array when no invocations exist', async () => {
    const mock = createChainMock();
    mock.order.mockResolvedValue({ data: [], error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getIterationInvocationsAction(VALID_RUN_ID, 99);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });
});

describe('getAgentInvocationsForRunAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns invocations for an agent across iterations', async () => {
    const mock = createChainMock();
    const rows = [
      { id: 'inv-1', run_id: VALID_RUN_ID, iteration: 0, agent_name: 'generation', execution_order: 0, success: true, cost_usd: 0.01, skipped: false, execution_detail: null },
      { id: 'inv-3', run_id: VALID_RUN_ID, iteration: 1, agent_name: 'generation', execution_order: 0, success: true, cost_usd: 0.012, skipped: false, execution_detail: null },
    ];
    mock.order.mockResolvedValue({ data: rows, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getAgentInvocationsForRunAction(VALID_RUN_ID, 'generation');
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data![1].iteration).toBe(1);
  });

  it('rejects invalid run ID', async () => {
    const result = await getAgentInvocationsForRunAction('bad-id', 'generation');
    expect(result.success).toBe(false);
  });
});

// ─── getInvocationFullDetailAction ──────────────────────────────

const VALID_INVOCATION_ID = '11111111-1111-1111-1111-111111111111';
const VALID_RUN_ID_2 = '22222222-2222-2222-2222-222222222222';

describe('getInvocationFullDetailAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('rejects invalid UUID', async () => {
    const result = await getInvocationFullDetailAction('bad-id');
    expect(result.success).toBe(false);
  });

  it('returns 404 when invocation not found', async () => {
    const mock = createChainMock();
    mock.single.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: 'not found' } });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getInvocationFullDetailAction(VALID_INVOCATION_ID);
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Invocation not found');
  });

  it('returns full detail for a valid invocation with variant diffs from DB', async () => {
    const mock = createChainMock();
    let singleCallCount = 0;
    mock.single.mockImplementation(() => {
      singleCallCount++;
      if (singleCallCount === 1) {
        // invocation query
        return Promise.resolve({
          data: {
            id: VALID_INVOCATION_ID,
            run_id: VALID_RUN_ID_2,
            iteration: 1,
            agent_name: 'evolution',
            execution_order: 0,
            success: true,
            cost_usd: 0.025,
            skipped: false,
            error_message: null,
            execution_detail: {
              detailType: 'evolution',
              _diffMetrics: {
                variantsAdded: 1,
                newVariantIds: ['variant-b'],
                matchesPlayed: 2,
                eloChanges: { 'variant-a': 10, 'variant-b': -10 },
                critiquesAdded: 0,
                diversityScoreAfter: null,
                metaFeedbackPopulated: false,
              },
            },
                created_at: '2026-03-04T12:00:00Z',
          },
          error: null,
        });
      }
      if (singleCallCount === 2) {
        // run metadata query (with explanations join)
        return Promise.resolve({
          data: {
            status: 'completed',
            phase: 'COMPETITION',
            explanation_id: 42,
            explanations: { title: 'Test Article' },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // V2: queries evolution_variants via .in() for new variants
    mock.in.mockResolvedValueOnce({
      data: [
        {
          id: 'variant-b',
          variant_content: 'Text for variant-b',
          elo_score: 1190,
          agent_name: 'evolution',
          parent_variant_id: 'variant-a',
        },
      ],
      error: null,
    });

    // Parent variant text lookup via maybeSingle
    let maybeSingleCount = 0;
    mock.maybeSingle.mockImplementation(() => {
      maybeSingleCount++;
      if (maybeSingleCount === 1) {
        // parent variant content
        return Promise.resolve({
          data: { variant_content: 'Text for variant-a' },
          error: null,
        });
      }
      if (maybeSingleCount === 2) {
        // input variant (top-rated variant before this invocation)
        return Promise.resolve({
          data: {
            id: 'variant-a',
            variant_content: 'Text for variant-a',
            elo_score: 1250,
            agent_name: 'generation',
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getInvocationFullDetailAction(VALID_INVOCATION_ID);
    expect(result.success).toBe(true);
    const data = result.data!;

    // Invocation metadata
    expect(data.invocation.id).toBe(VALID_INVOCATION_ID);
    expect(data.invocation.agentName).toBe('evolution');
    expect(data.invocation.costUsd).toBe(0.025);

    // Run metadata
    expect(data.run.explanationTitle).toBe('Test Article');
    expect(data.run.status).toBe('completed');

    // DiffMetrics from execution_detail._diffMetrics
    expect(data.diffMetrics?.newVariantIds).toEqual(['variant-b']);

    // Variant diffs from evolution_variants table
    expect(data.variantDiffs).toHaveLength(1);
    expect(data.variantDiffs[0].variantId).toBe('variant-b');
    expect(data.variantDiffs[0].parentId).toBe('variant-a');
    expect(data.variantDiffs[0].beforeText).toBe('Text for variant-a');
    expect(data.variantDiffs[0].afterText).toBe('Text for variant-b');

    // Input variant (top-rated from evolution_variants)
    expect(data.inputVariant?.variantId).toBe('variant-a');
    expect(data.inputVariant?.elo).toBe(1250);

    // Elo history (single snapshot per variant in V2)
    expect(data.eloHistory['variant-b']).toBeDefined();
    expect(data.eloHistory['variant-b'].length).toBeGreaterThan(0);
  });

  it('handles no execution_detail gracefully', async () => {
    const mock = createChainMock();
    let singleCallCount = 0;
    mock.single.mockImplementation(() => {
      singleCallCount++;
      if (singleCallCount === 1) {
        return Promise.resolve({
          data: {
            id: VALID_INVOCATION_ID,
            run_id: VALID_RUN_ID_2,
            iteration: 0,
            agent_name: 'generation',
            execution_order: 0,
            success: true,
            cost_usd: 0.01,
            skipped: false,
            error_message: null,
            execution_detail: null,
                created_at: '2026-03-04T12:00:00Z',
          },
          error: null,
        });
      }
      if (singleCallCount === 2) {
        return Promise.resolve({
          data: { status: 'running', phase: 'EXPANSION', explanation_id: null, explanations: null },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    // No newVariantIds so no .in() call; inputVariant query returns null
    mock.maybeSingle.mockResolvedValueOnce({ data: null, error: null });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getInvocationFullDetailAction(VALID_INVOCATION_ID);
    expect(result.success).toBe(true);
    expect(result.data!.variantDiffs).toHaveLength(0);
    expect(result.data!.inputVariant).toBeNull();
    expect(result.data!.eloHistory).toEqual({});
  });
});

// ─── listInvocationsAction ──────────────────────────────────────

describe('listInvocationsAction', () => {
  it('returns paginated invocations', async () => {
    const invocations = [
      { id: 'inv1', run_id: 'r1', iteration: 1, agent_name: 'generation', execution_order: 0, success: true, cost_usd: 0.05, skipped: false, error_message: null, created_at: '2026-01-01' },
    ];
    const invocationsChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: invocations, error: null, count: 1 }),
    };
    const enrichmentChain = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [{ id: 'r1', experiment_id: null, strategy_config_id: null }] }),
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue({
      from: jest.fn((table: string) => table === 'evolution_agent_invocations' ? invocationsChain : enrichmentChain),
    });

    const result = await listInvocationsAction({});

    expect(result.success).toBe(true);
    expect(result.data!.items).toHaveLength(1);
    expect(result.data!.total).toBe(1);
  });

  it('applies agent filter', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(chain),
    });

    await listInvocationsAction({ agentName: 'generation' });

    expect(chain.eq).toHaveBeenCalledWith('agent_name', 'generation');
  });

  it('handles database errors', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' }, count: null }),
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue({
      from: jest.fn().mockReturnValue(chain),
    });

    const result = await listInvocationsAction({});

    expect(result.success).toBe(false);
  });
});
