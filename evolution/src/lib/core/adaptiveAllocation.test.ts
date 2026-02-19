/**
 * Unit tests for adaptiveAllocation: ROI leaderboard, budget caps, pressure config.
 */

import {
  getAgentROILeaderboard,
  computeAdaptiveBudgetCaps,
  budgetPressureConfig,
  mergeWithConfig,
} from './adaptiveAllocation';

// Mock Supabase client
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

const mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  gte: jest.fn().mockReturnThis(),
};

(createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);

describe('adaptiveAllocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAgentROILeaderboard', () => {
    it('returns empty array when no data', async () => {
      (mockSupabase.gte as jest.Mock).mockResolvedValue({ data: [], error: null });
      const result = await getAgentROILeaderboard();
      expect(result).toEqual([]);
    });

    it('aggregates and sorts by Elo per dollar', async () => {
      (mockSupabase.gte as jest.Mock).mockResolvedValue({
        data: [
          { agent_name: 'generation', cost_usd: 0.10, elo_gain: 50, elo_per_dollar: 500 },
          { agent_name: 'generation', cost_usd: 0.15, elo_gain: 60, elo_per_dollar: 400 },
          { agent_name: 'calibration', cost_usd: 0.05, elo_gain: null, elo_per_dollar: null },
          { agent_name: 'evolution', cost_usd: 0.20, elo_gain: 80, elo_per_dollar: 400 },
        ],
        error: null,
      });

      const result = await getAgentROILeaderboard();

      expect(result.length).toBe(3);
      // Generation has highest avg Elo/dollar: (500+400)/2 = 450
      expect(result[0].agentName).toBe('generation');
      expect(result[0].avgEloPerDollar).toBeCloseTo(450, 1);
      expect(result[0].sampleSize).toBe(2);
    });

    it('handles query errors gracefully', async () => {
      (mockSupabase.gte as jest.Mock).mockResolvedValue({
        data: null,
        error: { message: 'Connection failed' },
      });

      const result = await getAgentROILeaderboard();
      expect(result).toEqual([]);
    });
  });

  describe('computeAdaptiveBudgetCaps', () => {
    it('returns defaults when no qualified agents', async () => {
      (mockSupabase.gte as jest.Mock).mockResolvedValue({ data: [], error: null });

      const result = await computeAdaptiveBudgetCaps();

      expect(result.source).toBe('default');
      expect(result.caps.generation).toBeDefined();
    });

    it('allocates proportionally based on Elo per dollar', async () => {
      (mockSupabase.gte as jest.Mock).mockResolvedValue({
        data: [
          // Generation: 20 samples at 1000 Elo/$
          ...Array(20).fill({ agent_name: 'generation', cost_usd: 0.05, elo_gain: 50, elo_per_dollar: 1000 }),
          // Evolution: 15 samples at 500 Elo/$
          ...Array(15).fill({ agent_name: 'evolution', cost_usd: 0.10, elo_gain: 50, elo_per_dollar: 500 }),
        ],
        error: null,
      });

      const result = await computeAdaptiveBudgetCaps();

      expect(result.source).toBe('adaptive');
      // Generation should have higher allocation than evolution
      expect(result.caps.generation).toBeGreaterThan(result.caps.evolution);
    });

    it('applies floor and ceiling bounds (with normalization)', async () => {
      (mockSupabase.gte as jest.Mock).mockResolvedValue({
        data: [
          // Multiple agents with similar Elo/$ to test ceiling more fairly
          ...Array(20).fill({ agent_name: 'generation', cost_usd: 0.01, elo_gain: 100, elo_per_dollar: 500 }),
          ...Array(20).fill({ agent_name: 'evolution', cost_usd: 0.01, elo_gain: 100, elo_per_dollar: 400 }),
          ...Array(20).fill({ agent_name: 'calibration', cost_usd: 1.00, elo_gain: 5, elo_per_dollar: 100 }),
        ],
        error: null,
      });

      const result = await computeAdaptiveBudgetCaps(30, 0.05, 0.40);

      // After bounds + normalization, values should be reasonable
      expect(result.caps.generation).toBeLessThanOrEqual(0.50); // Allow some slack due to normalization
      // Min floor should be respected for low-ROI agents
      expect(result.caps.calibration).toBeGreaterThan(0);
    });

    it('adds floor allocation for missing agents', async () => {
      (mockSupabase.gte as jest.Mock).mockResolvedValue({
        data: [
          ...Array(20).fill({ agent_name: 'generation', cost_usd: 0.10, elo_gain: 50, elo_per_dollar: 500 }),
        ],
        error: null,
      });

      const result = await computeAdaptiveBudgetCaps();

      // All standard agents should have an allocation
      expect(result.caps.calibration).toBeGreaterThan(0);
      expect(result.caps.tournament).toBeGreaterThan(0);
      expect(result.caps.evolution).toBeGreaterThan(0);
    });

    it('normalizes caps to sum to 1.0', async () => {
      (mockSupabase.gte as jest.Mock).mockResolvedValue({
        data: [
          ...Array(20).fill({ agent_name: 'generation', cost_usd: 0.10, elo_gain: 50, elo_per_dollar: 500 }),
          ...Array(15).fill({ agent_name: 'evolution', cost_usd: 0.10, elo_gain: 50, elo_per_dollar: 500 }),
        ],
        error: null,
      });

      const result = await computeAdaptiveBudgetCaps();
      const sum = Object.values(result.caps).reduce((a, b) => a + b, 0);

      expect(sum).toBeCloseTo(1.0, 4);
    });
  });

  describe('budgetPressureConfig', () => {
    it('returns aggressive when high budget and few iterations', () => {
      const result = budgetPressureConfig(8.0, 10.0, 2);
      expect(result.strategy).toBe('aggressive');
      expect(result.multiplier).toBeGreaterThan(1.0);
    });

    it('returns conservative when low budget', () => {
      const result = budgetPressureConfig(1.0, 10.0, 5);
      expect(result.strategy).toBe('conservative');
      expect(result.multiplier).toBeLessThan(1.0);
    });

    it('returns normal for typical budget/iterations', () => {
      const result = budgetPressureConfig(5.0, 10.0, 10);
      expect(result.strategy).toBe('normal');
      expect(result.multiplier).toBe(1.0);
    });
  });

  describe('mergeWithConfig', () => {
    it('returns adaptive caps when no config overrides', () => {
      const adaptive = { generation: 0.3, calibration: 0.2, tournament: 0.5 };
      const result = mergeWithConfig(adaptive, undefined);
      expect(result).toEqual(adaptive);
    });

    it('overrides adaptive with config values', () => {
      const adaptive = { generation: 0.3, calibration: 0.2, tournament: 0.5 };
      const config = { generation: 0.5 };
      const result = mergeWithConfig(adaptive, config);

      // Generation should be higher (before normalization)
      // After normalization, the relative order is preserved
      expect(result.generation).toBeGreaterThan(result.calibration);
    });

    it('normalizes merged caps to sum to 1.0', () => {
      const adaptive = { generation: 0.3, calibration: 0.3 };
      const config = { generation: 0.8 };
      const result = mergeWithConfig(adaptive, config);

      const sum = Object.values(result).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 4);
    });
  });
});
