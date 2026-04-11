// Integration tests for LogsTab filter queries against real Supabase.
// Verifies that each filter (level, entityType, iteration, agentName, messageSearch,
// variantId) and combined filters correctly scope the evolution_logs query.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Evolution Logs Filters Integration', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  const strategyId = crypto.randomUUID();
  const promptId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const suffix = Date.now();

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) {
      console.warn('Evolution tables do not exist — skipping logs filter tests');
      return;
    }

    // Create minimal dependencies
    await supabase.from('evolution_strategies').insert({
      id: strategyId,
      name: `[TEST] logs-filter-strategy-${suffix}`,
      label: 'Logs Filter Strategy',
      config: {},
      config_hash: `logs-filter-hash-${suffix}`,
    });
    await supabase.from('evolution_prompts').insert({
      id: promptId,
      prompt: `[TEST] logs-filter-prompt-${suffix}`,
      name: `[TEST] Logs Filter Prompt ${suffix}`,
    });
    await supabase.from('evolution_runs').insert({
      id: runId,
      strategy_id: strategyId,
      prompt_id: promptId,
      status: 'completed',
    });

    // Insert test log rows covering each filter dimension
    const { error } = await supabase.from('evolution_logs').insert([
      {
        run_id: runId,
        entity_type: 'run',
        entity_id: runId,
        level: 'info',
        message: `alpha message ${suffix}`,
        agent_name: 'generation-agent',
        iteration: 1,
        variant_id: null,
      },
      {
        run_id: runId,
        entity_type: 'run',
        entity_id: runId,
        level: 'error',
        message: `beta message ${suffix}`,
        agent_name: 'ranking-agent',
        iteration: 2,
        variant_id: null,
      },
      {
        run_id: runId,
        entity_type: 'invocation',
        entity_id: runId,
        level: 'info',
        message: `gamma message ${suffix}`,
        agent_name: 'generation-agent',
        iteration: 1,
        variant_id: variantId,
      },
    ]);
    if (error) throw new Error(`Failed to insert test logs: ${error.message}`);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    // Delete logs first (FK dependency on runs)
    await supabase.from('evolution_logs').delete().eq('run_id', runId);
    await cleanupEvolutionData(supabase, {
      runIds: [runId],
      strategyIds: [strategyId],
      promptIds: [promptId],
    });
  });

  it('level filter returns only logs of that level', async () => {
    if (!tablesExist) return;
    const { data, error } = await supabase
      .from('evolution_logs')
      .select('id, level')
      .eq('run_id', runId)
      .eq('level', 'error');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.level).toBe('error');
  });

  it('entityType filter scopes to correct entity type', async () => {
    if (!tablesExist) return;
    const { data, error } = await supabase
      .from('evolution_logs')
      .select('id, entity_type')
      .eq('run_id', runId)
      .eq('entity_type', 'invocation');
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.entity_type).toBe('invocation');
  });

  it('iteration filter returns only that iteration logs', async () => {
    if (!tablesExist) return;
    const { data, error } = await supabase
      .from('evolution_logs')
      .select('id, iteration')
      .eq('run_id', runId)
      .eq('iteration', 2);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.iteration).toBe(2);
  });

  it('agentName partial match returns logs where agent_name contains substring', async () => {
    if (!tablesExist) return;
    const { data, error } = await supabase
      .from('evolution_logs')
      .select('id, agent_name')
      .eq('run_id', runId)
      .ilike('agent_name', '%generation%');
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.every(r => r.agent_name?.includes('generation'))).toBe(true);
  });

  it('messageSearch returns only logs where message ilike matches', async () => {
    if (!tablesExist) return;
    const escaped = `alpha message ${suffix}`.replace(/[%_\\]/g, '\\$&');
    const { data, error } = await supabase
      .from('evolution_logs')
      .select('id, message')
      .eq('run_id', runId)
      .ilike('message', `%${escaped}%`);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.message).toContain('alpha');
  });

  it('variantId filter returns only logs for that variant', async () => {
    if (!tablesExist) return;
    const { data, error } = await supabase
      .from('evolution_logs')
      .select('id, variant_id')
      .eq('run_id', runId)
      .eq('variant_id', variantId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.variant_id).toBe(variantId);
  });

  it('combined filters (level + agentName) return intersection', async () => {
    if (!tablesExist) return;
    const { data, error } = await supabase
      .from('evolution_logs')
      .select('id, level, agent_name')
      .eq('run_id', runId)
      .eq('level', 'info')
      .ilike('agent_name', '%generation%');
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
    expect(data?.every(r => r.level === 'info' && r.agent_name?.includes('generation'))).toBe(true);
  });
});
