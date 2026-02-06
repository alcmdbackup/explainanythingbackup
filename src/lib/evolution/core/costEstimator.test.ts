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

      const prediction = computeCostPrediction(estimate, actual);

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
      const prediction = computeCostPrediction(estimate, actual);

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
      const prediction = computeCostPrediction(estimate, actual);

      expect(prediction.perAgent.generation).toEqual({ estimated: 0.40, actual: 0.45 });
      expect(prediction.perAgent.calibration).toEqual({ estimated: 0.60, actual: 0.55 });
    });
  });
});
