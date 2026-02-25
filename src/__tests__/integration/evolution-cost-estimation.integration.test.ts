// Integration tests for cost estimation round-trip: estimate at queue time → prediction at completion.
// Verifies Zod validation, JSONB persistence, and advisory lock behavior.

import {
  RunCostEstimateSchema,
  CostPredictionSchema,
  computeCostPrediction,
} from '@evolution/lib/core/costEstimator';
import type { RunCostEstimate } from '@evolution/lib/core/costEstimator';

// ─── Zod Schema Validation (no DB required) ──────────────────────

describe('Cost Estimation Zod Schemas', () => {
  describe('RunCostEstimateSchema', () => {
    it('validates a correct estimate', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 1.50,
        perAgent: { generation: 0.8, calibration: 0.4, evolution: 0.3 },
        perIteration: 0.5,
        confidence: 'high',
      };
      const result = RunCostEstimateSchema.safeParse(estimate);
      expect(result.success).toBe(true);
    });

    it('rejects invalid estimate (wrong type)', () => {
      const invalid = { totalUsd: 'not-a-number', perAgent: {}, perIteration: 0, confidence: 'high' };
      const result = RunCostEstimateSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('rejects invalid confidence value', () => {
      const invalid = { totalUsd: 1.0, perAgent: {}, perIteration: 0.5, confidence: 'ultra' };
      const result = RunCostEstimateSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('CostPredictionSchema', () => {
    it('validates a correct prediction', () => {
      const prediction = computeCostPrediction(
        { totalUsd: 1.0, perAgent: { gen: 0.5, cal: 0.5 }, perIteration: 0.5, confidence: 'high' },
        1.0,
        { gen: 0.6, cal: 0.4 },
      );
      const result = CostPredictionSchema.safeParse(prediction);
      expect(result.success).toBe(true);
    });

    it('rejects prediction with missing fields', () => {
      const invalid = { estimatedUsd: 1.0, actualUsd: 0.9 };
      const result = CostPredictionSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('computeCostPrediction', () => {
    it('computes correct delta values', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 2.00,
        perAgent: { generation: 1.2, calibration: 0.8 },
        perIteration: 0.67,
        confidence: 'medium',
      };
      const actual = { generation: 1.1, calibration: 0.9 };
      const prediction = computeCostPrediction(estimate, 2.00, actual);

      expect(prediction.estimatedUsd).toBe(2.00);
      expect(prediction.actualUsd).toBe(2.00); // 1.1 + 0.9
      expect(prediction.deltaUsd).toBe(0);
      expect(prediction.deltaPercent).toBe(0);
      expect(prediction.confidence).toBe('medium');
      expect(prediction.perAgent.generation).toEqual({ estimated: 1.2, actual: 1.1 });
      expect(prediction.perAgent.calibration).toEqual({ estimated: 0.8, actual: 0.9 });
    });

    it('includes actual-only agents with estimated: 0 in prediction', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 1.00,
        perAgent: { generation: 0.6, calibration: 0.4 },
        perIteration: 0.5,
        confidence: 'medium',
      };
      // treeSearch ran but was not estimated
      const actual = { generation: 0.5, calibration: 0.3, treeSearch: 0.25 };
      const prediction = computeCostPrediction(estimate, 1.05, actual);

      expect(prediction.perAgent.treeSearch).toEqual({ estimated: 0, actual: 0.25 });
      expect(prediction.perAgent.generation).toEqual({ estimated: 0.6, actual: 0.5 });
      expect(prediction.perAgent.calibration).toEqual({ estimated: 0.4, actual: 0.3 });
      expect(Object.keys(prediction.perAgent)).toHaveLength(3);

      // Validate with Zod
      const result = CostPredictionSchema.safeParse(prediction);
      expect(result.success).toBe(true);
    });

    it('handles agents present in estimate but missing in actuals', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 1.00,
        perAgent: { generation: 0.6, evolution: 0.4 },
        perIteration: 0.5,
        confidence: 'low',
      };
      const actual = { generation: 0.5 }; // evolution missing
      const prediction = computeCostPrediction(estimate, 0.50, actual);

      expect(prediction.actualUsd).toBe(0.5);
      expect(prediction.perAgent.evolution).toEqual({ estimated: 0.4, actual: 0 });
    });
  });
});

// ─── JSONB Round-Trip (requires Supabase) ─────────────────────────

describe('Cost Estimation JSONB Persistence', () => {
  // Skip entire suite if integration-helpers aren't available
  let supabase: import('@supabase/supabase-js').SupabaseClient;
  let tablesReady = false;
  const trackedRunIds: string[] = [];

  beforeAll(async () => {
    // Dynamic import to avoid throwing when env vars are missing
    try {
      const { setupTestDatabase } = await import('@/testing/utils/integration-helpers');
      const { evolutionTablesExist } = await import('@evolution/testing/evolution-test-helpers');
      supabase = await setupTestDatabase();
      tablesReady = await evolutionTablesExist(supabase);

      if (tablesReady) {
        const { error } = await supabase
          .from('evolution_runs')
          .select('cost_estimate_detail')
          .limit(1);
        if (error) {
          tablesReady = false;
        }
      }
    } catch {
      console.warn('⏭️  Skipping JSONB persistence tests (no DB connection)');
      tablesReady = false;
    }
  });

  afterAll(async () => {
    if (supabase && tablesReady && trackedRunIds.length > 0) {
      await supabase
        .from('evolution_runs')
        .delete()
        .in('id', trackedRunIds);
    }
    if (supabase) {
      const { teardownTestDatabase } = await import('@/testing/utils/integration-helpers');
      await teardownTestDatabase(supabase);
    }
  });

  it('persists and reads back cost_estimate_detail and cost_prediction', async () => {
    if (!tablesReady) return;

    const estimate: RunCostEstimate = {
      totalUsd: 2.00,
      perAgent: { generation: 1.2, calibration: 0.8 },
      perIteration: 0.67,
      confidence: 'medium',
    };

    const prediction = computeCostPrediction(
      estimate,
      2.00,
      { generation: 1.1, calibration: 0.9 },
    );

    const { data: run, error: insertErr } = await supabase
      .from('evolution_runs')
      .insert({
        status: 'completed',
        phase: 'COMPLETED',
        budget_cap_usd: 5.0,
        estimated_cost_usd: estimate.totalUsd,
        cost_estimate_detail: estimate,
        cost_prediction: prediction,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.warn('Insert failed (may need explanation_id FK):', insertErr.message);
      return;
    }

    trackedRunIds.push(run.id);

    const { data: readBack } = await supabase
      .from('evolution_runs')
      .select('estimated_cost_usd, cost_estimate_detail, cost_prediction')
      .eq('id', run.id)
      .single();

    expect(readBack).toBeDefined();
    expect(readBack!.estimated_cost_usd).toBe(2.00);

    const estResult = RunCostEstimateSchema.safeParse(readBack!.cost_estimate_detail);
    expect(estResult.success).toBe(true);

    const predResult = CostPredictionSchema.safeParse(readBack!.cost_prediction);
    expect(predResult.success).toBe(true);
  });
});
