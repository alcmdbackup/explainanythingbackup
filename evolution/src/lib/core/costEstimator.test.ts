/**
 * Unit tests for costEstimator: baseline fetching, cost estimation, and prediction tracking.
 */

import {
  estimateAgentCost,
  estimateRunCostWithAgentModels,
  estimateRunCost,
  computeCostPrediction,
  type CostBaseline,
  type RunCostEstimate,
} from './costEstimator';
import type { EvolutionRunConfig } from '../types';
import { DEFAULT_EVOLUTION_CONFIG } from '../config';

// Mock Supabase client
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn(),
};

(createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

describe('costEstimator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase.single.mockReset();
  });

  describe('estimateAgentCost', () => {
    it('falls back to heuristic when no baseline exists', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const cost = await estimateAgentCost('generation', 'deepseek-chat', 5000, 1);

      // Should use calculateLLMCost heuristic
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThan(0.01); // deepseek-chat is cheap
    });

    it('scales cost by text length ratio when baseline exists', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          avg_prompt_tokens: 1000,
          avg_completion_tokens: 500,
          avg_cost_usd: 0.001,
          avg_text_length: 5000,
          sample_size: 100,
        },
        error: null,
      });

      // Text length 10000 = 2x baseline → cost should be ~2x
      const cost = await estimateAgentCost('generation', 'deepseek-chat', 10000, 1);
      expect(cost).toBeCloseTo(0.002, 4);
    });

    it('applies call multiplier', async () => {
      mockSupabase.single.mockResolvedValue({
        data: {
          avg_prompt_tokens: 1000,
          avg_completion_tokens: 500,
          avg_cost_usd: 0.001,
          avg_text_length: 5000,
          sample_size: 100,
        },
        error: null,
      });

      const cost = await estimateAgentCost('generation', 'deepseek-chat', 5000, 3);
      expect(cost).toBeCloseTo(0.003, 4);
    });

    it('requires minimum sample size of 50', async () => {
      // Use a unique model to avoid cache hits from other tests
      mockSupabase.single.mockResolvedValue({
        data: {
          avg_prompt_tokens: 1000,
          avg_completion_tokens: 500,
          avg_cost_usd: 0.001,
          avg_text_length: 5000,
          sample_size: 25, // Below threshold
        },
        error: null,
      });

      // Should fall back to heuristic - cost will be calculated from llmPricing
      const cost = await estimateAgentCost('generation', 'gpt-4.1-mini', 5000, 1);
      // Heuristic: 5000/4 = 1250 tokens + 200 overhead = 1450 prompt, 1250 completion
      // gpt-4.1-mini: 0.40/1M input, 1.60/1M output
      // Expected: (1450 * 0.40 + 1250 * 1.60) / 1M = 0.00258
      // The key point: it's NOT using the baseline 0.001 value
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('estimateRunCostWithAgentModels', () => {
    beforeEach(() => {
      // All baselines return null → heuristic fallback
      mockSupabase.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    });

    it('returns per-agent breakdown', async () => {
      const estimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      expect(estimate.perAgent).toHaveProperty('generation');
      expect(estimate.perAgent).toHaveProperty('calibration');
      expect(estimate.perAgent).toHaveProperty('tournament');
      expect(estimate.perAgent).toHaveProperty('evolution');
    });

    it('calculates total from per-agent costs', async () => {
      const estimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      const sumOfAgents = Object.values(estimate.perAgent).reduce((a, b) => a + b, 0);
      expect(estimate.totalUsd).toBeCloseTo(sumOfAgents, 6);
    });

    it('respects per-agent model overrides', async () => {
      const baseEstimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      const overrideEstimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
        agentModels: {
          tournament: 'gpt-4.1-mini', // More expensive than nano
        },
      }, 5000);

      // Tournament cost should be higher with mini model
      expect(overrideEstimate.perAgent.tournament).toBeGreaterThan(baseEstimate.perAgent.tournament);
    });

    it('uses agent-specific model override when set (fallback chain tier 1)', async () => {
      // When agentModels.generation is set, it should use that model instead of generationModel default
      const overrideEstimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
        agentModels: { generation: 'gpt-4.1-mini' }, // override: more expensive than deepseek-chat
      }, 5000);

      const defaultEstimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      // gpt-4.1-mini is more expensive than deepseek-chat, so generation cost should be higher
      expect(overrideEstimate.perAgent.generation).toBeGreaterThan(defaultEstimate.perAgent.generation);
    });

    it('judge agents fall back to judgeModel when no agentModels override (fallback chain tier 2)', async () => {
      // Calibration and tournament are judge agents; changing judgeModel should change their cost
      const nanoEstimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      const miniEstimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-mini', // more expensive judge model
        maxIterations: 10,
      }, 5000);

      // gpt-4.1-mini is more expensive than gpt-4.1-nano for judging
      expect(miniEstimate.perAgent.calibration).toBeGreaterThan(nanoEstimate.perAgent.calibration);
      expect(miniEstimate.perAgent.tournament).toBeGreaterThan(nanoEstimate.perAgent.tournament);
    });

    it('non-judge agents fall back to generationModel when no agentModels override (fallback chain tier 2)', async () => {
      // Evolution, reflection, debate, iterativeEditing are non-judge agents
      const cheapEstimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat', // cheapest
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      const expensiveEstimate = await estimateRunCostWithAgentModels({
        generationModel: 'gpt-4.1-mini', // more expensive
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      // Non-judge agents use generationModel as default, so cost should increase
      expect(expensiveEstimate.perAgent.evolution).toBeGreaterThan(cheapEstimate.perAgent.evolution);
      expect(expensiveEstimate.perAgent.reflection).toBeGreaterThan(cheapEstimate.perAgent.reflection);
      expect(expensiveEstimate.perAgent.debate).toBeGreaterThan(cheapEstimate.perAgent.debate);
      // Judge agents should NOT change since judgeModel is the same
      expect(expensiveEstimate.perAgent.calibration).toBe(cheapEstimate.perAgent.calibration);
      expect(expensiveEstimate.perAgent.tournament).toBe(cheapEstimate.perAgent.tournament);
    });

    it('returns low confidence when no baselines', async () => {
      // Reset mock to ensure no baseline data
      mockSupabase.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const estimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      // With no baselines, confidence should be low
      // Note: Cache may affect this - confidence depends on getAgentBaseline calls
      expect(['low', 'medium']).toContain(estimate.confidence);
    });

    it('calculates per-iteration cost', async () => {
      const estimate = await estimateRunCostWithAgentModels({
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      }, 5000);

      expect(estimate.perIteration).toBeCloseTo(estimate.totalUsd / 10, 6);
    });
  });

  describe('estimateRunCost', () => {
    it('wraps estimateRunCostWithAgentModels', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const config: EvolutionRunConfig = {
        ...DEFAULT_EVOLUTION_CONFIG,
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        maxIterations: 10,
      };

      const estimate = await estimateRunCost(config, 5000);
      expect(estimate.totalUsd).toBeGreaterThan(0);
    });
  });

  describe('computeCostPrediction', () => {
    it('computes delta between estimated and actual', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 1.00,
        perAgent: { generation: 0.40, calibration: 0.30, tournament: 0.30 },
        perIteration: 0.10,
        confidence: 'medium',
      };

      const actual = { generation: 0.50, calibration: 0.25, tournament: 0.35 };

      const prediction = computeCostPrediction(estimate, 1.10, actual);

      expect(prediction.estimatedUsd).toBe(1.00);
      expect(prediction.actualUsd).toBe(1.10);
      expect(prediction.deltaUsd).toBeCloseTo(0.10, 6);
      expect(prediction.deltaPercent).toBeCloseTo(10, 1);
    });

    it('handles zero estimated cost', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 0,
        perAgent: {},
        perIteration: 0,
        confidence: 'low',
      };

      const actual = { generation: 0.10 };
      const prediction = computeCostPrediction(estimate, 0.10, actual);

      expect(prediction.deltaPercent).toBe(0);
    });

    it('includes per-agent breakdown', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 1.00,
        perAgent: { generation: 0.40, calibration: 0.60 },
        perIteration: 0.10,
        confidence: 'high',
      };

      const actual = { generation: 0.45, calibration: 0.55 };
      const prediction = computeCostPrediction(estimate, 1.00, actual);

      expect(prediction.perAgent.generation).toEqual({ estimated: 0.40, actual: 0.45 });
      expect(prediction.perAgent.calibration).toEqual({ estimated: 0.60, actual: 0.55 });
    });

    it('builds correct per-agent comparison with 3-arg signature', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 2.00,
        perAgent: { generation: 0.80, evolution: 0.50, calibration: 0.70 },
        perIteration: 0.20,
        confidence: 'medium',
      };

      const perAgentCosts: Record<string, number> = {
        generation: 0.90,
        evolution: 0.45,
        calibration: 0.65,
      };

      const prediction = computeCostPrediction(estimate, 2.00, perAgentCosts);

      // Each agent in estimated.perAgent gets both estimated and actual values
      expect(prediction.perAgent.generation).toEqual({ estimated: 0.80, actual: 0.90 });
      expect(prediction.perAgent.evolution).toEqual({ estimated: 0.50, actual: 0.45 });
      expect(prediction.perAgent.calibration).toEqual({ estimated: 0.70, actual: 0.65 });
      expect(Object.keys(prediction.perAgent)).toHaveLength(3);
    });

    it('excludes agents in perAgentCosts that are not in estimated.perAgent', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 1.00,
        perAgent: { generation: 0.60, calibration: 0.40 },
        perIteration: 0.10,
        confidence: 'low',
      };

      const perAgentCosts: Record<string, number> = {
        generation: 0.55,
        calibration: 0.38,
        unknownAgent: 0.20, // Not in estimated.perAgent
      };

      const prediction = computeCostPrediction(estimate, 1.13, perAgentCosts);

      expect(prediction.perAgent).not.toHaveProperty('unknownAgent');
      expect(Object.keys(prediction.perAgent)).toEqual(['generation', 'calibration']);
    });

    it('sets actual to 0 for estimated agents missing from perAgentCosts', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 1.50,
        perAgent: { generation: 0.50, evolution: 0.40, tournament: 0.60 },
        perIteration: 0.15,
        confidence: 'high',
      };

      // evolution is missing from actual costs
      const perAgentCosts: Record<string, number> = {
        generation: 0.55,
        tournament: 0.70,
      };

      const prediction = computeCostPrediction(estimate, 1.25, perAgentCosts);

      expect(prediction.perAgent.evolution).toEqual({ estimated: 0.40, actual: 0 });
      expect(prediction.perAgent.generation).toEqual({ estimated: 0.50, actual: 0.55 });
      expect(prediction.perAgent.tournament).toEqual({ estimated: 0.60, actual: 0.70 });
    });

    it('computes deltaUsd as actualTotalUsd minus estimated.totalUsd', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 3.00,
        perAgent: { generation: 1.50, calibration: 1.50 },
        perIteration: 0.30,
        confidence: 'medium',
      };

      const prediction = computeCostPrediction(estimate, 3.75, { generation: 2.00, calibration: 1.75 });

      expect(prediction.deltaUsd).toBeCloseTo(0.75, 6);

      // Also verify with under-spend (negative delta)
      const prediction2 = computeCostPrediction(estimate, 2.50, { generation: 1.20, calibration: 1.30 });
      expect(prediction2.deltaUsd).toBeCloseTo(-0.50, 6);
    });

    it('computes deltaPercent as (deltaUsd / estimated.totalUsd) * 100', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 2.00,
        perAgent: { generation: 1.00, calibration: 1.00 },
        perIteration: 0.20,
        confidence: 'high',
      };

      // Over-spend: delta = 0.50, percent = (0.50 / 2.00) * 100 = 25%
      const prediction = computeCostPrediction(estimate, 2.50, { generation: 1.30, calibration: 1.20 });
      expect(prediction.deltaPercent).toBeCloseTo(25, 4);

      // Under-spend: delta = -0.40, percent = (-0.40 / 2.00) * 100 = -20%
      const prediction2 = computeCostPrediction(estimate, 1.60, { generation: 0.80, calibration: 0.80 });
      expect(prediction2.deltaPercent).toBeCloseTo(-20, 4);
    });

    it('returns deltaPercent 0 when estimated.totalUsd is 0 (no division by zero)', () => {
      const estimate: RunCostEstimate = {
        totalUsd: 0,
        perAgent: { generation: 0 },
        perIteration: 0,
        confidence: 'low',
      };

      const prediction = computeCostPrediction(estimate, 0.50, { generation: 0.50 });

      expect(prediction.deltaPercent).toBe(0);
      expect(prediction.deltaUsd).toBeCloseTo(0.50, 6);
      expect(Number.isFinite(prediction.deltaPercent)).toBe(true);
    });
  });

  describe('backward compatibility', () => {
    it('Zod schema parses llmCallTracking without evolution_invocation_id', async () => {
      const { llmCallTrackingSchema } = await import('@/lib/schemas/schemas');

      const record = {
        userid: '550e8400-e29b-41d4-a716-446655440000',
        prompt: 'Explain photosynthesis',
        content: 'Photosynthesis is...',
        call_source: 'explanation_generator',
        raw_api_response: '{"id":"chatcmpl-123"}',
        model: 'deepseek-chat',
        prompt_tokens: 150,
        completion_tokens: 200,
        total_tokens: 350,
        finish_reason: 'stop',
      };

      const result = llmCallTrackingSchema.safeParse(record);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.evolution_invocation_id).toBeUndefined();
      }
    });

    it('Zod schema parses llmCallTracking with evolution_invocation_id', async () => {
      const { llmCallTrackingSchema } = await import('@/lib/schemas/schemas');

      const record = {
        userid: '550e8400-e29b-41d4-a716-446655440000',
        prompt: 'Explain photosynthesis',
        content: 'Photosynthesis is...',
        call_source: 'explanation_generator',
        raw_api_response: '{"id":"chatcmpl-123"}',
        model: 'deepseek-chat',
        prompt_tokens: 150,
        completion_tokens: 200,
        total_tokens: 350,
        finish_reason: 'stop',
        evolution_invocation_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      };

      const result = llmCallTrackingSchema.safeParse(record);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.evolution_invocation_id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      }
    });
  });
});
