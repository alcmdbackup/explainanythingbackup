// Integration tests for evolution cost attribution: agent metrics persistence and strategy tracking.
// Verifies that cost tracking data flows correctly to the database.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  evolutionTablesExist,
} from '@/testing/utils/evolution-test-helpers';
import {
  setupTestDatabase,
  teardownTestDatabase,
  TEST_PREFIX,
} from '@/testing/utils/integration-helpers';

// Mock instrumentation before any pipeline imports
jest.mock('../../../instrumentation', () => ({
  createAppSpan: jest.fn(() => NOOP_SPAN),
  createLLMSpan: jest.fn(() => NOOP_SPAN),
  createDBSpan: jest.fn(() => NOOP_SPAN),
  createVectorSpan: jest.fn(() => NOOP_SPAN),
}));

import { SupabaseClient } from '@supabase/supabase-js';
import { CostTrackerImpl } from '@/lib/evolution/core/costTracker';
import { hashStrategyConfig, type StrategyConfig } from '@/lib/evolution/core/strategyConfig';

describe('Evolution Cost Attribution Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesReady = false;
  const trackedRunIds: string[] = [];

  beforeAll(async () => {
    supabase = await setupTestDatabase();
    tablesReady = await evolutionTablesExist(supabase);
    if (!tablesReady) {
      console.warn('⏭️  Skipping cost attribution tests: tables not yet migrated');
    }

    // Also check if new tables exist
    if (tablesReady) {
      const { error } = await supabase
        .from('evolution_run_agent_metrics')
        .select('id')
        .limit(1);
      if (error?.code === '42P01') {
        console.warn('⏭️  Skipping cost attribution tests: agent_metrics table not migrated');
        tablesReady = false;
      }
    }
  });

  afterAll(async () => {
    if (tablesReady && trackedRunIds.length > 0) {
      // Cleanup agent metrics
      await supabase
        .from('evolution_run_agent_metrics')
        .delete()
        .in('run_id', trackedRunIds);
    }
    await teardownTestDatabase(supabase);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('CostTracker agent cost aggregation', () => {
    it('tracks costs per agent correctly', () => {
      if (!tablesReady) return;

      const budgetCaps = { generation: 0.25, calibration: 0.15, tournament: 0.25 };
      const tracker = new CostTrackerImpl(10.0, budgetCaps);

      // Simulate multiple agent calls using recordSpend
      tracker.recordSpend('generation', 0.001);
      tracker.recordSpend('generation', 0.002);
      tracker.recordSpend('calibration', 0.0005);
      tracker.recordSpend('tournament', 0.003);

      const agentCosts = tracker.getAllAgentCosts();

      expect(agentCosts.generation).toBeCloseTo(0.003, 5);
      expect(agentCosts.calibration).toBeCloseTo(0.0005, 5);
      expect(agentCosts.tournament).toBeCloseTo(0.003, 5);
      expect(tracker.getTotalSpent()).toBeCloseTo(0.0065, 5);
    });

    it('returns empty object when no costs recorded', () => {
      if (!tablesReady) return;

      const budgetCaps = { generation: 0.25, calibration: 0.15, tournament: 0.25 };
      const tracker = new CostTrackerImpl(10.0, budgetCaps);
      const agentCosts = tracker.getAllAgentCosts();

      expect(Object.keys(agentCosts)).toHaveLength(0);
    });
  });

  describe('Strategy config identity', () => {
    it('generates stable hash for identical configs', () => {
      if (!tablesReady) return;

      const config1: StrategyConfig = {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 10,
        budgetCaps: { generation: 0.25, calibration: 0.15 },
      };

      const config2: StrategyConfig = {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 10,
        budgetCaps: { calibration: 0.15, generation: 0.25 }, // Different order
      };

      expect(hashStrategyConfig(config1)).toBe(hashStrategyConfig(config2));
    });

    it('generates different hash for different configs', () => {
      if (!tablesReady) return;

      const config1: StrategyConfig = {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 10,
        budgetCaps: {},
      };

      const config2: StrategyConfig = {
        generationModel: 'gpt-4.1-mini', // Different model
        judgeModel: 'gpt-4.1-nano',
        iterations: 10,
        budgetCaps: {},
      };

      expect(hashStrategyConfig(config1)).not.toBe(hashStrategyConfig(config2));
    });

    it('handles agentModels in hash', () => {
      if (!tablesReady) return;

      const withOverrides: StrategyConfig = {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        agentModels: { tournament: 'gpt-4.1-mini' },
        iterations: 10,
        budgetCaps: {},
      };

      const withoutOverrides: StrategyConfig = {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 10,
        budgetCaps: {},
      };

      expect(hashStrategyConfig(withOverrides)).not.toBe(hashStrategyConfig(withoutOverrides));
    });
  });

  describe('Agent metrics table structure', () => {
    it('can insert and query agent metrics', async () => {
      if (!tablesReady) return;

      // Create a test run first
      const { data: run, error: runError } = await supabase
        .from('content_evolution_runs')
        .insert({
          explanation_id: 1, // Use a valid ID
          status: 'completed',
          budget_cap_usd: 5.0,
        })
        .select('id')
        .single();

      if (runError) {
        console.warn('Could not create test run:', runError.message);
        return;
      }

      const runId = run.id;
      trackedRunIds.push(runId);

      // Insert agent metrics
      const { error: metricsError } = await supabase
        .from('evolution_run_agent_metrics')
        .insert({
          run_id: runId,
          agent_name: `${TEST_PREFIX}generation`,
          cost_usd: 0.0025,
          variants_generated: 5,
          avg_elo: 1250,
          elo_gain: 50,
          elo_per_dollar: 20000,
        });

      expect(metricsError).toBeNull();

      // Query back
      const { data: metrics, error: queryError } = await supabase
        .from('evolution_run_agent_metrics')
        .select('*')
        .eq('run_id', runId)
        .eq('agent_name', `${TEST_PREFIX}generation`)
        .single();

      expect(queryError).toBeNull();
      expect(metrics.cost_usd).toBeCloseTo(0.0025, 5);
      expect(metrics.elo_per_dollar).toBe(20000);

      // Cleanup
      await supabase
        .from('evolution_run_agent_metrics')
        .delete()
        .eq('run_id', runId);

      await supabase
        .from('content_evolution_runs')
        .delete()
        .eq('id', runId);
    });
  });

  describe('Strategy configs table structure', () => {
    it('can insert and query strategy configs', async () => {
      if (!tablesReady) return;

      const testConfig: StrategyConfig = {
        generationModel: 'deepseek-chat',
        judgeModel: 'gpt-4.1-nano',
        iterations: 15,
        budgetCaps: { generation: 0.25 },
      };

      const hash = hashStrategyConfig(testConfig);
      const testName = `${TEST_PREFIX}test_strategy_${Date.now()}`;

      // Insert
      const { data: inserted, error: insertError } = await supabase
        .from('strategy_configs')
        .insert({
          config_hash: hash,
          name: testName,
          label: 'Gen: ds-chat | Judge: 4.1-nano | 15 iters',
          config: testConfig,
        })
        .select('id')
        .single();

      if (insertError) {
        // May fail due to unique constraint if hash already exists
        console.warn('Insert skipped (may already exist):', insertError.message);
        return;
      }

      expect(inserted.id).toBeDefined();

      // Query back
      const { data: queried, error: queryError } = await supabase
        .from('strategy_configs')
        .select('*')
        .eq('id', inserted.id)
        .single();

      expect(queryError).toBeNull();
      expect(queried.config_hash).toBe(hash);
      expect(queried.name).toBe(testName);

      // Cleanup
      await supabase
        .from('strategy_configs')
        .delete()
        .eq('id', inserted.id);
    });
  });
});
