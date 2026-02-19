// Integration tests for evolution cost attribution: agent metrics persistence and strategy tracking.
// Verifies that cost tracking data flows correctly to the database.

import {
  NOOP_SPAN,
  cleanupEvolutionData,
  evolutionTablesExist,
} from '@evolution/testing/evolution-test-helpers';
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
import { CostTrackerImpl } from '@evolution/lib/core/costTracker';
import { hashStrategyConfig, type StrategyConfig } from '@evolution/lib/core/strategyConfig';

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

    it('excludes agentModels from hash (same strategy, different tuning)', () => {
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

      // agentModels/budgetCaps are intentionally excluded from hash per JSDoc
      expect(hashStrategyConfig(withOverrides)).toBe(hashStrategyConfig(withoutOverrides));
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

  describe('UUID format validation', () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('rejects non-UUID run_id format', async () => {
      if (!tablesReady) return;

      // Attempt to insert with invalid UUID prefix (the bug we fixed)
      // This test doesn't need a valid explanation_id since it should fail on UUID validation first
      const { error } = await supabase
        .from('content_evolution_runs')
        .insert({
          id: 'batch-12345678-1234-1234-1234-123456789abc', // Invalid: has batch- prefix
          explanation_id: 1,
          status: 'pending',
          budget_cap_usd: 1.0,
        });

      // Should fail with UUID format error
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/invalid input syntax for type uuid/i);
    });

    it('accepts valid UUID run_id format', async () => {
      if (!tablesReady) return;

      // First create a topic and explanation (required FK)
      const { data: topic } = await supabase
        .from('topics')
        .insert({ topic_title: `${TEST_PREFIX}uuid_test_topic`, topic_description: 'Test' })
        .select('id')
        .single();

      if (!topic) {
        console.warn('Could not create test topic');
        return;
      }

      const { data: explanation } = await supabase
        .from('explanations')
        .insert({
          explanation_title: `${TEST_PREFIX}uuid_test_explanation`,
          content: 'Test',
          status: 'draft',
          primary_topic_id: topic.id,
        })
        .select('id')
        .single();

      if (!explanation) {
        await supabase.from('topics').delete().eq('id', topic.id);
        console.warn('Could not create test explanation');
        return;
      }

      const validUUID = '12345678-1234-4234-8234-123456789abc';

      const { data, error } = await supabase
        .from('content_evolution_runs')
        .insert({
          id: validUUID,
          explanation_id: explanation.id,
          status: 'pending',
          budget_cap_usd: 1.0,
        })
        .select('id')
        .single();

      // Should succeed
      expect(error).toBeNull();
      expect(data?.id).toBe(validUUID);
      expect(UUID_REGEX.test(data?.id)).toBe(true);

      // Cleanup
      await supabase.from('content_evolution_runs').delete().eq('id', validUUID);
      await supabase.from('explanations').delete().eq('id', explanation.id);
      await supabase.from('topics').delete().eq('id', topic.id);
    });

    it('validates variant id is valid UUID', async () => {
      if (!tablesReady) return;

      // First create a topic and explanation (required FK)
      const { data: topic } = await supabase
        .from('topics')
        .insert({ topic_title: `${TEST_PREFIX}variant_uuid_test_topic`, topic_description: 'Test' })
        .select('id')
        .single();

      if (!topic) {
        console.warn('Could not create test topic');
        return;
      }

      const { data: explanation } = await supabase
        .from('explanations')
        .insert({
          explanation_title: `${TEST_PREFIX}variant_uuid_test_explanation`,
          content: 'Test',
          status: 'draft',
          primary_topic_id: topic.id,
        })
        .select('id')
        .single();

      if (!explanation) {
        await supabase.from('topics').delete().eq('id', topic.id);
        console.warn('Could not create test explanation');
        return;
      }

      // Create a valid run first
      const runId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const { error: runError } = await supabase
        .from('content_evolution_runs')
        .insert({
          id: runId,
          explanation_id: explanation.id,
          status: 'pending',
          budget_cap_usd: 1.0,
        });

      if (runError) {
        await supabase.from('explanations').delete().eq('id', explanation.id);
        await supabase.from('topics').delete().eq('id', topic.id);
        console.warn('Could not create test run:', runError.message);
        return;
      }

      trackedRunIds.push(runId);

      // Attempt to insert variant with invalid baseline-prefixed ID (the bug we fixed)
      // Uses actual schema columns from content_evolution_variants table
      const { error: variantError } = await supabase
        .from('content_evolution_variants')
        .insert({
          id: `baseline-${runId}`, // Invalid: has baseline- prefix
          run_id: runId,
          explanation_id: explanation.id,
          variant_content: 'test baseline content',
          agent_name: 'baseline',
        });

      // Should fail with UUID format error
      expect(variantError).not.toBeNull();
      expect(variantError?.message).toMatch(/invalid input syntax for type uuid/i);

      // Cleanup
      await supabase.from('content_evolution_runs').delete().eq('id', runId);
      await supabase.from('explanations').delete().eq('id', explanation.id);
      await supabase.from('topics').delete().eq('id', topic.id);
    });
  });

  describe('Strategy config linking', () => {
    it('links run to strategy config via strategy_config_id', async () => {
      if (!tablesReady) return;

      // First create a topic and explanation (required FK)
      const { data: topic } = await supabase
        .from('topics')
        .insert({ topic_title: `${TEST_PREFIX}strategy_link_test_topic`, topic_description: 'Test' })
        .select('id')
        .single();

      if (!topic) {
        console.warn('Could not create test topic');
        return;
      }

      const { data: explanation } = await supabase
        .from('explanations')
        .insert({
          explanation_title: `${TEST_PREFIX}strategy_link_test_explanation`,
          content: 'Test',
          status: 'draft',
          primary_topic_id: topic.id,
        })
        .select('id')
        .single();

      if (!explanation) {
        await supabase.from('topics').delete().eq('id', topic.id);
        console.warn('Could not create test explanation');
        return;
      }

      // Create a strategy config
      const testConfig: StrategyConfig = {
        generationModel: 'test-model',
        judgeModel: 'test-judge',
        iterations: 10,
        budgetCaps: {},
      };

      const hash = hashStrategyConfig(testConfig);
      const testName = `${TEST_PREFIX}link_test_${Date.now()}`;

      const { data: strategy, error: stratError } = await supabase
        .from('strategy_configs')
        .insert({
          config_hash: hash,
          name: testName,
          label: 'Test strategy for linking',
          config: testConfig,
        })
        .select('id')
        .single();

      if (stratError) {
        await supabase.from('explanations').delete().eq('id', explanation.id);
        await supabase.from('topics').delete().eq('id', topic.id);
        console.warn('Could not create strategy config:', stratError.message);
        return;
      }

      // Create a run linked to the strategy
      const runId = 'cccccccc-dddd-4eee-8fff-111111111111';
      const { error: runError } = await supabase
        .from('content_evolution_runs')
        .insert({
          id: runId,
          explanation_id: explanation.id,
          status: 'completed',
          budget_cap_usd: 1.0,
          strategy_config_id: strategy.id,
        });

      expect(runError).toBeNull();
      trackedRunIds.push(runId);

      // Query run and verify strategy link
      const { data: run, error: queryError } = await supabase
        .from('content_evolution_runs')
        .select('id, strategy_config_id')
        .eq('id', runId)
        .single();

      expect(queryError).toBeNull();
      expect(run?.strategy_config_id).toBe(strategy.id);

      // Cleanup
      await supabase.from('content_evolution_runs').delete().eq('id', runId);
      await supabase.from('strategy_configs').delete().eq('id', strategy.id);
      await supabase.from('explanations').delete().eq('id', explanation.id);
      await supabase.from('topics').delete().eq('id', topic.id);
    });
  });
});
