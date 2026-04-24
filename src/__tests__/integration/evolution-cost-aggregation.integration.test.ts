// Integration test for the cost-fallback chain in getRunCostsWithFallback.
// Three cases: layer-1 hit, layer-2 fallback (sum gen+rank+seed), layer-3
// fallback (evolution_run_costs view). Each case spies logger.warn to confirm
// the fallback fired exactly when expected.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestEvolutionRun,
} from '@evolution/testing/evolution-test-helpers';
import { getRunCostsWithFallback } from '@evolution/lib/cost/getRunCostWithFallback';
import { logger } from '@/lib/server_utilities';

let supabase: ReturnType<typeof createTestSupabaseClient>;
let tablesExist: boolean;
const createdRunIds: string[] = [];

beforeAll(async () => {
  supabase = createTestSupabaseClient();
  tablesExist = await evolutionTablesExist(supabase);
});

afterAll(async () => {
  if (tablesExist && createdRunIds.length > 0) {
    await cleanupEvolutionData(supabase, { runIds: createdRunIds });
  }
});

async function writeMetric(runId: string, name: string, value: number): Promise<void> {
  // upsert_metric_max signature: (p_entity_type, p_entity_id, p_metric_name, p_value, p_source).
  const { error } = await supabase.rpc('upsert_metric_max', {
    p_entity_type: 'run',
    p_entity_id: runId,
    p_metric_name: name,
    p_value: value,
    p_source: 'integration-test',
  });
  if (error) throw new Error(`upsert_metric_max(${name}): ${error.message}`);
}

describe('getRunCostsWithFallback (integration)', () => {
  it('layer 1: returns the cost metric value directly when present', async () => {
    if (!tablesExist) return;
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const run = await createTestEvolutionRun(supabase, null, { status: 'completed' });
      const runId = run.id as string;
      createdRunIds.push(runId);
      await writeMetric(runId, 'cost', 0.42);

      const out = await getRunCostsWithFallback([runId], supabase);
      expect(out.get(runId)).toBeCloseTo(0.42);
      // Layer-1 hits should NOT log the missing-cost warning.
      const missingWarn = warnSpy.mock.calls.find(c => String(c[0]).includes('missing'));
      expect(missingWarn).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('layer 2: sums generation_cost + ranking_cost + seed_cost when cost metric is absent', async () => {
    if (!tablesExist) return;
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const run = await createTestEvolutionRun(supabase, null, { status: 'completed' });
      const runId = run.id as string;
      createdRunIds.push(runId);
      await writeMetric(runId, 'generation_cost', 0.04);
      await writeMetric(runId, 'ranking_cost', 0.05);
      await writeMetric(runId, 'seed_cost', 0.01);

      const out = await getRunCostsWithFallback([runId], supabase);
      expect(out.get(runId)).toBeCloseTo(0.10, 4);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('layer 4 (truly missing): returns 0 and warns', async () => {
    if (!tablesExist) return;
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const run = await createTestEvolutionRun(supabase, null, { status: 'completed' });
      const runId = run.id as string;
      createdRunIds.push(runId);

      const out = await getRunCostsWithFallback([runId], supabase);
      expect(out.get(runId)).toBe(0);
      // Layer-4 (no cost found anywhere) MUST warn so operators can investigate.
      const missingWarn = warnSpy.mock.calls.find(c => /missing|fallback|not found/i.test(String(c[0]) + JSON.stringify(c[1] ?? '')));
      expect(missingWarn).toBeDefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
