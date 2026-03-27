// Tests the strategy config hash find-or-create (upsertStrategy) against real Supabase DB.
// Verifies deterministic hashing, iteration sensitivity, and budget exclusion from hash.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import { upsertStrategy } from '@evolution/lib/pipeline/setup/findOrCreateStrategy';
import type { V2StrategyConfig } from '@evolution/lib/pipeline/infra/types';

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

    const config: V2StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 3,
    };

    const id1 = await upsertStrategy(supabase, config);
    createdStrategyIds.push(id1);

    const id2 = await upsertStrategy(supabase, config);
    // id2 should be same row, but track in case upsert creates a new one
    if (!createdStrategyIds.includes(id2)) createdStrategyIds.push(id2);

    expect(id1).toBe(id2);
  });

  it('different iterations produces different strategy', async () => {
    if (!tablesExist) return;

    const configA: V2StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 5,
    };
    const configB: V2StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 10,
    };

    const idA = await upsertStrategy(supabase, configA);
    createdStrategyIds.push(idA);

    const idB = await upsertStrategy(supabase, configB);
    if (!createdStrategyIds.includes(idB)) createdStrategyIds.push(idB);

    expect(idA).not.toBe(idB);
  });

  it('budget is excluded from hash — same strategy returned', async () => {
    if (!tablesExist) return;

    const configNoBudget: V2StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 7,
    };
    const configWithBudget: V2StrategyConfig = {
      generationModel: 'gpt-4.1-mini',
      judgeModel: 'gpt-4.1-nano',
      iterations: 7,
      budgetUsd: 10.0,
    };

    const id1 = await upsertStrategy(supabase, configNoBudget);
    createdStrategyIds.push(id1);

    const id2 = await upsertStrategy(supabase, configWithBudget);
    if (!createdStrategyIds.includes(id2)) createdStrategyIds.push(id2);

    expect(id1).toBe(id2);
  });
});
