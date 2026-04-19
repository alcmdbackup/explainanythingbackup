// Tests the strategy config hash find-or-create (upsertStrategy) against real Supabase DB.
// Verifies deterministic hashing, iterationConfigs sensitivity, and budget exclusion from hash.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import { upsertStrategy } from '@evolution/lib/pipeline/setup/findOrCreateStrategy';
import type { StrategyConfig } from '@evolution/lib/pipeline/infra/types';

describe('Evolution Strategy Hash Integration Tests', () => {
  let supabase: SupabaseClient;
  let tablesExist: boolean;

  const createdStrategyIds: string[] = [];

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
  });

  afterAll(async () => {
    if (!tablesExist) return;
    await cleanupEvolutionData(supabase, {
      strategyIds: createdStrategyIds,
    });
  });

  it('same config produces same strategy ID', async () => {
    if (!tablesExist) return;

    const config: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
    };

    const id1 = await upsertStrategy(supabase, config);
    createdStrategyIds.push(id1);

    const id2 = await upsertStrategy(supabase, config);
    // id2 should be same row, but track in case upsert creates a new one
    if (!createdStrategyIds.includes(id2)) createdStrategyIds.push(id2);

    expect(id1).toBe(id2);
  });

  it('different iterationConfigs produces different strategy', async () => {
    if (!tablesExist) return;

    const configA: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
    };
    const configB: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 40 }, { agentType: 'swiss', budgetPercent: 30 }, { agentType: 'generate', budgetPercent: 30 }],
    };

    const idA = await upsertStrategy(supabase, configA);
    createdStrategyIds.push(idA);

    const idB = await upsertStrategy(supabase, configB);
    if (!createdStrategyIds.includes(idB)) createdStrategyIds.push(idB);

    expect(idA).not.toBe(idB);
  });

  it('budget is excluded from hash — same strategy returned', async () => {
    if (!tablesExist) return;

    const configNoBudget: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
    };
    const configWithBudget: StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
      budgetUsd: 10.0,
    };

    const id1 = await upsertStrategy(supabase, configNoBudget);
    createdStrategyIds.push(id1);

    const id2 = await upsertStrategy(supabase, configWithBudget);
    if (!createdStrategyIds.includes(id2)) createdStrategyIds.push(id2);

    expect(id1).toBe(id2);
  });
});
