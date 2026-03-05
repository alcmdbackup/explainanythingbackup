// Tests for evolution visualization server actions: timeline checkpoint diffing and cost attribution.

import {
  getEvolutionRunTimelineAction,
  getEvolutionRunBudgetAction,
  buildVariantsFromCheckpoint,
  getAgentInvocationDetailAction,
  getIterationInvocationsAction,
  getAgentInvocationsForRunAction,
  getInvocationFullDetailAction,
  type TimelineData,
  type BudgetData,
  type InvocationFullDetail,
} from './evolutionVisualizationActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import type { SerializedPipelineState, TextVariation, Match } from '@evolution/lib/types';

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

/** Create a minimal TextVariation for testing. */
function createVariant(id: string, iterationBorn = 0): TextVariation {
  return {
    id,
    text: `Text for ${id}`,
    version: 1,
    parentIds: [],
    strategy: 'generation',
    createdAt: Date.now(),
    iterationBorn,
  };
}

/** Create a minimal SerializedPipelineState for testing. */
function createSnapshot(opts: {
  pool?: TextVariation[];
  eloRatings?: Record<string, number>;
  matchHistory?: Match[];
  matchCounts?: Record<string, number>;
  allCritiques?: null;
  debateTranscripts?: [];
  diversityScore?: number | null;
  metaFeedback?: null;
  ratings?: Record<string, { mu: number; sigma: number }>;
} = {}): SerializedPipelineState {
  return {
    iteration: 0,
    originalText: 'Original text',
    pool: opts.pool ?? [],
    newEntrantsThisIteration: [],
    ratings: opts.ratings ?? {},
    eloRatings: opts.eloRatings ?? {},
    matchCounts: opts.matchCounts ?? {},
    matchHistory: opts.matchHistory ?? [],
    dimensionScores: null,
    allCritiques: opts.allCritiques ?? null,
    similarityMatrix: null,
    diversityScore: opts.diversityScore ?? null,
    metaFeedback: opts.metaFeedback ?? null,
    debateTranscripts: opts.debateTranscripts ?? [],
  };
}

describe('getEvolutionRunTimelineAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns multiple agents per iteration when checkpoints exist', async () => {
    const mock = createChainMock();
    const variantA = createVariant('variant-a', 0);
    const variantB = createVariant('variant-b', 0);
    const variantC = createVariant('variant-c', 0);

    // Mock queries: order calls 1-2 = checkpoints, calls 3-4 = invocations
    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      if (queryCount === 2) {
        return Promise.resolve({
          data: [
            {
              iteration: 0,
              phase: 'EXPANSION',
              last_agent: 'generation',
              state_snapshot: createSnapshot({ pool: [variantA] }),
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              iteration: 0,
              phase: 'EXPANSION',
              last_agent: 'calibration',
              state_snapshot: createSnapshot({
                pool: [variantA, variantB],
                eloRatings: { 'variant-a': 1220, 'variant-b': 1180 },
                matchHistory: [{ variationA: 'variant-a', variationB: 'variant-b', winner: 'variant-a', confidence: 0.8, turns: 1, dimensionScores: {} }],
              }),
              created_at: '2026-01-01T00:01:00Z',
            },
            {
              iteration: 0,
              phase: 'EXPANSION',
              last_agent: 'proximity',
              state_snapshot: createSnapshot({
                pool: [variantA, variantB, variantC],
                diversityScore: 0.75,
              }),
              created_at: '2026-01-01T00:02:00Z',
            },
          ],
          error: null,
        });
      }
      // Invocations query terminal
      if (queryCount === 4) {
        return Promise.resolve({ data: [], error: null });
      }
      return mock;
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.iterations).toHaveLength(1);
    expect(result.data!.iterations[0].agents).toHaveLength(3);
    expect(result.data!.iterations[0].agents.map(a => a.name)).toEqual(['generation', 'calibration', 'proximity']);
  });

  it('computes variantsAdded by diffing sequential checkpoints', async () => {
    const mock = createChainMock();
    const variantA = createVariant('variant-a', 0);
    const variantB = createVariant('variant-b', 0);

    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      if (queryCount === 2) {
        return Promise.resolve({
          data: [
            {
              iteration: 0,
              phase: 'EXPANSION',
              last_agent: 'generation',
              state_snapshot: createSnapshot({ pool: [variantA] }),
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              iteration: 0,
              phase: 'EXPANSION',
              last_agent: 'evolution',
              state_snapshot: createSnapshot({ pool: [variantA, variantB] }),
              created_at: '2026-01-01T00:01:00Z',
            },
          ],
          error: null,
        });
      }
      if (queryCount === 4) {
        return Promise.resolve({ data: [], error: null });
      }
      return mock;
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const agents = result.data!.iterations[0].agents;

    // Generation added 1 variant (from empty baseline)
    expect(agents[0].variantsAdded).toBe(1);
    expect(agents[0].newVariantIds).toEqual(['variant-a']);

    // Evolution added 1 variant (diff from generation checkpoint)
    expect(agents[1].variantsAdded).toBe(1);
    expect(agents[1].newVariantIds).toEqual(['variant-b']);
  });

  it('computes matchesPlayed by diffing match history', async () => {
    const mock = createChainMock();
    const match1: Match = { variationA: 'a', variationB: 'b', winner: 'a', confidence: 0.8, turns: 1, dimensionScores: {} };
    const match2: Match = { variationA: 'b', variationB: 'c', winner: 'c', confidence: 0.7, turns: 1, dimensionScores: {} };

    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      if (queryCount === 2) {
        return Promise.resolve({
          data: [
            {
              iteration: 0,
              phase: 'COMPETITION',
              last_agent: 'calibration',
              state_snapshot: createSnapshot({ matchHistory: [match1] }),
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              iteration: 0,
              phase: 'COMPETITION',
              last_agent: 'tournament',
              state_snapshot: createSnapshot({ matchHistory: [match1, match2] }),
              created_at: '2026-01-01T00:01:00Z',
            },
          ],
          error: null,
        });
      }
      if (queryCount === 4) {
        return Promise.resolve({ data: [], error: null });
      }
      return mock;
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const agents = result.data!.iterations[0].agents;

    // Calibration played 1 match
    expect(agents[0].matchesPlayed).toBe(1);

    // Tournament added 1 more match
    expect(agents[1].matchesPlayed).toBe(1);
  });

  it('computes eloChanges by diffing elo ratings', async () => {
    const mock = createChainMock();

    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      if (queryCount === 2) {
        return Promise.resolve({
          data: [
            {
              iteration: 0,
              phase: 'COMPETITION',
              last_agent: 'calibration',
              state_snapshot: createSnapshot({ eloRatings: { 'a': 1200, 'b': 1200 } }),
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              iteration: 0,
              phase: 'COMPETITION',
              last_agent: 'tournament',
              state_snapshot: createSnapshot({ eloRatings: { 'a': 1250, 'b': 1150 } }),
              created_at: '2026-01-01T00:01:00Z',
            },
          ],
          error: null,
        });
      }
      if (queryCount === 4) {
        return Promise.resolve({ data: [], error: null });
      }
      return mock;
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const agents = result.data!.iterations[0].agents;

    // Tournament should show elo changes
    expect(agents[1].eloChanges).toEqual({ 'a': 50, 'b': -50 });
  });

  it('populates iteration totals correctly', async () => {
    const mock = createChainMock();
    const variantA = createVariant('variant-a', 0);
    const variantB = createVariant('variant-b', 0);

    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      if (queryCount === 2) {
        return Promise.resolve({
          data: [
            {
              iteration: 0,
              phase: 'EXPANSION',
              last_agent: 'generation',
              state_snapshot: createSnapshot({ pool: [variantA] }),
              created_at: '2026-01-01T00:00:00Z',
            },
            {
              iteration: 0,
              phase: 'EXPANSION',
              last_agent: 'evolution',
              state_snapshot: createSnapshot({ pool: [variantA, variantB] }),
              created_at: '2026-01-01T00:01:00Z',
            },
          ],
          error: null,
        });
      }
      // Invocations with cumulative cost_usd per agent (deltas: 0.01 + 0.02 = 0.03)
      if (queryCount === 4) {
        return Promise.resolve({
          data: [
            { iteration: 0, agent_name: 'generation', cost_usd: 0.01, execution_order: 0 },
            { iteration: 0, agent_name: 'evolution', cost_usd: 0.02, execution_order: 1 },
          ],
          error: null,
        });
      }
      return mock;
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionRunTimelineAction('550e8400-e29b-41d4-a716-446655440000');

    expect(result.success).toBe(true);
    const iter = result.data!.iterations[0];

    expect(iter.totalVariantsAdded).toBe(2); // 1 + 1
    expect(iter.totalCostUsd).toBeCloseTo(0.03, 4); // 0.01 + 0.02
  });

  it('returns error for invalid run ID format', async () => {
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
    const result = await getEvolutionRunTimelineAction('not-a-uuid');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Invalid run ID');
  });

  it('handles empty checkpoints gracefully', async () => {
    const mock = createChainMock();

    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      // Empty checkpoints
      if (queryCount === 2) {
        return Promise.resolve({ data: [], error: null });
      }
      // Empty invocations
      if (queryCount === 4) {
        return Promise.resolve({ data: [], error: null });
      }
      return mock;
    });

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

  it('maps checkpoint pool to EvolutionVariant shape correctly', async () => {
    const mock = createChainMock();
    const now = 1700000000000;
    const variant: TextVariation = {
      id: 'v-1',
      text: 'Hello world',
      version: 2,
      parentIds: [],
      strategy: 'evolution',
      createdAt: now,
      iterationBorn: 1,
    };

    const snapshot = createSnapshot({
      pool: [variant],
      ratings: { 'v-1': { mu: 28, sigma: 4 } },
      matchCounts: { 'v-1': 5 },
    });

    mock.maybeSingle.mockResolvedValueOnce({
      data: { state_snapshot: snapshot },
      error: null,
    });
    mock.single.mockResolvedValueOnce({
      data: { explanation_id: 42 },
      error: null,
    });

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
    expect(v.elo_score).toBeGreaterThan(1200); // mu 28 with sigma 4 → ordinal > 0
    expect(v.created_at).toBe(new Date(now).toISOString());
  });

  it('handles legacy eloRatings format', async () => {
    const mock = createChainMock();
    const variant = createVariant('v-legacy', 0);
    const snapshot = createSnapshot({
      pool: [variant],
      eloRatings: { 'v-legacy': 1350 },
    });

    mock.maybeSingle.mockResolvedValueOnce({
      data: { state_snapshot: snapshot },
      error: null,
    });
    mock.single.mockResolvedValueOnce({
      data: { explanation_id: null },
      error: null,
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data![0].elo_score).toBe(1350);
  });

  it('returns empty array when no checkpoint exists', async () => {
    const mock = createChainMock();

    mock.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    mock.single.mockResolvedValueOnce({
      data: { explanation_id: 1 },
      error: null,
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('sorts by elo_score descending', async () => {
    const mock = createChainMock();
    const vA = createVariant('v-a', 0);
    const vB = createVariant('v-b', 0);
    const snapshot = createSnapshot({
      pool: [vA, vB],
      eloRatings: { 'v-a': 1100, 'v-b': 1400 },
    });

    mock.maybeSingle.mockResolvedValueOnce({
      data: { state_snapshot: snapshot },
      error: null,
    });
    mock.single.mockResolvedValueOnce({
      data: { explanation_id: null },
      error: null,
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    expect(result.data![0].elo_score).toBe(1400);
    expect(result.data![1].elo_score).toBe(1100);
  });

  it('sets is_winner: false for all variants', async () => {
    const mock = createChainMock();
    const vA = createVariant('v-a', 0);
    const vB = createVariant('v-b', 0);
    const snapshot = createSnapshot({ pool: [vA, vB] });

    mock.maybeSingle.mockResolvedValueOnce({
      data: { state_snapshot: snapshot },
      error: null,
    });
    mock.single.mockResolvedValueOnce({
      data: { explanation_id: null },
      error: null,
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await buildVariantsFromCheckpoint(RUN_ID);

    expect(result.success).toBe(true);
    for (const v of result.data!) {
      expect(v.is_winner).toBe(false);
    }
  });

  it('handles missing matchCounts and ratings gracefully (defaults to 0 / 1200)', async () => {
    const mock = createChainMock();
    const variant = createVariant('v-no-data', 0);
    // Snapshot with empty ratings and matchCounts
    const snapshot = createSnapshot({ pool: [variant] });

    mock.maybeSingle.mockResolvedValueOnce({
      data: { state_snapshot: snapshot },
      error: null,
    });
    mock.single.mockResolvedValueOnce({
      data: { explanation_id: null },
      error: null,
    });

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

  it('returns full detail for a valid invocation with checkpoints', async () => {
    const variantA = createVariant('variant-a', 0);
    const variantB = { ...createVariant('variant-b', 1), parentIds: ['variant-a'], strategy: 'evolution' };

    const beforeSnapshot = createSnapshot({
      pool: [variantA],
      eloRatings: { 'variant-a': 1250 },
    });
    const afterSnapshot = createSnapshot({
      pool: [variantA, variantB],
      eloRatings: { 'variant-a': 1260, 'variant-b': 1190 },
    });

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
                debatesAdded: 0,
                diversityScoreAfter: null,
                metaFeedbackPopulated: false,
              },
            },
            agent_attribution: null,
            created_at: '2026-03-04T12:00:00Z',
          },
          error: null,
        });
      }
      if (singleCallCount === 2) {
        // run metadata query
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

    // Checkpoint query (order chain)
    let orderCallCount = 0;
    mock.order.mockImplementation(() => {
      orderCallCount++;
      if (orderCallCount === 2) {
        return Promise.resolve({
          data: [
            { iteration: 0, last_agent: 'generation', state_snapshot: beforeSnapshot, created_at: '2026-03-04T11:00:00Z' },
            { iteration: 1, last_agent: 'evolution', state_snapshot: afterSnapshot, created_at: '2026-03-04T12:00:00Z' },
          ],
          error: null,
        });
      }
      return mock;
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

    // DiffMetrics
    expect(data.diffMetrics?.newVariantIds).toEqual(['variant-b']);

    // Variant diffs
    expect(data.variantDiffs).toHaveLength(1);
    expect(data.variantDiffs[0].variantId).toBe('variant-b');
    expect(data.variantDiffs[0].parentId).toBe('variant-a');
    expect(data.variantDiffs[0].beforeText).toBe('Text for variant-a');
    expect(data.variantDiffs[0].afterText).toBe('Text for variant-b');

    // Input variant (top-rated from before pool)
    expect(data.inputVariant?.variantId).toBe('variant-a');
    expect(data.inputVariant?.elo).toBe(1250);

    // Elo history
    expect(data.eloHistory['variant-b']).toBeDefined();
    expect(data.eloHistory['variant-b'].length).toBeGreaterThan(0);
  });

  it('handles no checkpoints gracefully', async () => {
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
            agent_attribution: null,
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

    // No checkpoints
    let orderCallCount = 0;
    mock.order.mockImplementation(() => {
      orderCallCount++;
      if (orderCallCount === 2) {
        return Promise.resolve({ data: [], error: null });
      }
      return mock;
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getInvocationFullDetailAction(VALID_INVOCATION_ID);
    expect(result.success).toBe(true);
    expect(result.data!.variantDiffs).toHaveLength(0);
    expect(result.data!.inputVariant).toBeNull();
    expect(result.data!.eloHistory).toEqual({});
  });
});
