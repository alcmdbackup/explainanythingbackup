// Tests for evolution visualization server actions: timeline checkpoint diffing and cost attribution.

import {
  getEvolutionRunTimelineAction,
  getEvolutionRunBudgetAction,
  type TimelineData,
  type BudgetData,
} from './evolutionVisualizationActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import type { SerializedPipelineState, TextVariation, Match } from '@/lib/evolution/types';

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
    matchCounts: {},
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

    // Mock checkpoint query (order returns the mock to chain)
    let queryCount = 0;
    mock.order.mockImplementation(() => {
      queryCount++;
      // Second order call is terminal for checkpoints
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
      return mock;
    });

    // Mock run query
    mock.single.mockResolvedValue({
      data: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
      error: null,
    });

    // Mock cost query (lte is terminal)
    mock.lte.mockResolvedValue({
      data: [
        { call_source: 'evolution_generation', estimated_cost_usd: 0.01, created_at: '2026-01-01T00:00:30Z' },
        { call_source: 'evolution_calibration', estimated_cost_usd: 0.005, created_at: '2026-01-01T00:01:30Z' },
      ],
      error: null,
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
      return mock;
    });

    mock.single.mockResolvedValue({
      data: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
      error: null,
    });

    mock.lte.mockResolvedValue({ data: [], error: null });

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
      return mock;
    });

    mock.single.mockResolvedValue({
      data: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
      error: null,
    });

    mock.lte.mockResolvedValue({ data: [], error: null });

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
      return mock;
    });

    mock.single.mockResolvedValue({
      data: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
      error: null,
    });

    mock.lte.mockResolvedValue({ data: [], error: null });

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
      return mock;
    });

    mock.single.mockResolvedValue({
      data: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
      error: null,
    });

    mock.lte.mockResolvedValue({
      data: [
        { call_source: 'evolution_generation', estimated_cost_usd: 0.01, created_at: '2026-01-01T00:00:30Z' },
        { call_source: 'evolution_evolution', estimated_cost_usd: 0.02, created_at: '2026-01-01T00:01:30Z' },
      ],
      error: null,
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
      if (queryCount === 2) {
        return Promise.resolve({ data: [], error: null });
      }
      return mock;
    });

    mock.single.mockResolvedValue({
      data: { started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
      error: null,
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
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T01:00:00Z',
        budget_cap_usd: 5,
        cost_estimate_detail: mockEstimate,
        cost_prediction: mockPrediction,
      },
      error: null,
    });

    // Terminal for LLM calls query (lte)
    mock.lte.mockResolvedValue({
      data: [
        { call_source: 'evolution_generation', estimated_cost_usd: 0.7, created_at: '2026-01-01T00:01:00Z' },
        { call_source: 'evolution_calibration', estimated_cost_usd: 0.35, created_at: '2026-01-01T00:02:00Z' },
      ],
      error: null,
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
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T01:00:00Z',
        budget_cap_usd: 5,
        cost_estimate_detail: null,
        cost_prediction: null,
      },
      error: null,
    });

    mock.lte.mockResolvedValue({ data: [], error: null });

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
});
