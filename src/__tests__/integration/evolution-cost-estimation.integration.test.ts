// Integration test for cost estimation accuracy and strategy config validation.
// Verifies that: (1) new strategy config fields persist and parse correctly,
// (2) cross-field validation (bufferAfterParallel >= bufferAfterSequential) works,
// (3) estimateCosts functions produce reasonable values with real pricing data.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
} from '@evolution/testing/evolution-test-helpers';
import { strategyConfigSchema } from '@evolution/lib/schemas';
import {
  estimateGenerationCost,
  estimateRankingCost,
  estimateAgentCost,
} from '@evolution/lib/pipeline/infra/estimateCosts';

let supabase: ReturnType<typeof createTestSupabaseClient>;
let tablesExist: boolean;
const createdStrategyIds: string[] = [];

beforeAll(async () => {
  supabase = createTestSupabaseClient();
  tablesExist = await evolutionTablesExist(supabase);
});

afterAll(async () => {
  if (tablesExist && createdStrategyIds.length > 0) {
    await cleanupEvolutionData(supabase, { strategyIds: createdStrategyIds });
  }
});

describe('Strategy config with budget dispatch fields', () => {
  it('persists and round-trips new fields via DB', async () => {
    if (!tablesExist) return;

    const config = {
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'gpt-oss-20b',
      iterations: 1,
      maxVariantsToGenerateFromSeedArticle: 5,
      maxComparisonsPerVariant: 10,
      budgetBufferAfterParallel: 0.40,
      budgetBufferAfterSequential: 0.15,
    };

    const { data, error } = await supabase
      .from('evolution_strategies')
      .insert({
        name: '[TEST] Budget Dispatch Strategy',
        config,
        config_hash: `test-budget-${Date.now()}`,
        status: 'active',
      })
      .select('id, config')
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    createdStrategyIds.push(data!.id);

    // Round-trip: parse the config back through Zod
    const parsed = strategyConfigSchema.safeParse(data!.config);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.maxVariantsToGenerateFromSeedArticle).toBe(5);
      expect(parsed.data.maxComparisonsPerVariant).toBe(10);
      expect(parsed.data.budgetBufferAfterParallel).toBe(0.40);
      expect(parsed.data.budgetBufferAfterSequential).toBe(0.15);
    }
  });

  it('rejects bufferAfterSequential > bufferAfterParallel', () => {
    const result = strategyConfigSchema.safeParse({
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'gpt-4.1-nano',
      iterations: 1,
      budgetBufferAfterParallel: 0.20,
      budgetBufferAfterSequential: 0.30,
    });
    expect(result.success).toBe(false);
  });

  it('rejects sequential-only without parallel', () => {
    const result = strategyConfigSchema.safeParse({
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'gpt-4.1-nano',
      iterations: 1,
      budgetBufferAfterSequential: 0.30,
    });
    expect(result.success).toBe(false);
  });

  it('accepts legacy config without new fields', () => {
    const result = strategyConfigSchema.safeParse({
      generationModel: 'gpt-4.1-nano',
      judgeModel: 'gpt-4.1-nano',
      iterations: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe('Cost estimation functions with real pricing', () => {
  it('estimateGenerationCost produces reasonable values', () => {
    // gpt-4.1-nano: $0.10/1M input, $0.40/1M output
    const cost = estimateGenerationCost(10000, 'structural_transform', 'gpt-4.1-nano');
    expect(cost).toBeGreaterThan(0.0005);
    expect(cost).toBeLessThan(0.01);
  });

  it('estimateRankingCost scales with pool size', () => {
    const smallPool = estimateRankingCost(5000, 'gpt-oss-20b', 3, 15);
    const largePool = estimateRankingCost(5000, 'gpt-oss-20b', 20, 15);
    expect(largePool).toBeGreaterThan(smallPool);
    const hugePool = estimateRankingCost(5000, 'gpt-oss-20b', 100, 15);
    expect(hugePool).toBe(largePool);
  });

  it('estimateAgentCost is generation + ranking', () => {
    const gen = estimateGenerationCost(10000, 'grounding_enhance', 'gpt-4.1-nano');
    const rank = estimateRankingCost(11799, 'gpt-oss-20b', 5, 15);
    const total = estimateAgentCost(10000, 'grounding_enhance', 'gpt-4.1-nano', 'gpt-oss-20b', 5, 15);
    expect(total).toBeCloseTo(gen + rank, 6);
  });
});
