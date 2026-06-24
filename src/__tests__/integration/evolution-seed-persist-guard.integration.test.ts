// Integration test for the seed-variant persist guard against REAL Supabase: when the parent run is
// deleted mid-persist (the parallel-teardown race that produced the intermittent
// evolution_variants_run_id_fkey failure), persistSeedVariantRow aborts gracefully with a typed
// RunDeletedDuringExecutionError rather than an unhandled FK throw; an existing run persists normally.
// Evolution-prefixed so CI routes it to the evolution integration bucket + auto-skips pre-migration.

import { randomUUID } from 'crypto';
import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  evolutionTablesExist,
  cleanupEvolutionData,
  createTestEvolutionRun,
} from '@evolution/testing/evolution-test-helpers';
import {
  persistSeedVariantRow,
  RunDeletedDuringExecutionError,
} from '@evolution/lib/pipeline/persistSeedVariant';

const logger = { warn: (): void => {}, error: (): void => {} };

describe('seed-variant persist guard (integration)', () => {
  let sb: SupabaseClient;
  let ok = false;
  const strategyIds: string[] = [];
  const promptIds: string[] = [];
  const runIds: string[] = [];

  beforeAll(async () => {
    sb = createTestSupabaseClient();
    ok = await evolutionTablesExist(sb);
  }, 60000);

  afterAll(async () => {
    if (!ok) return;
    for (const rid of runIds) await sb.from('evolution_variants').delete().eq('run_id', rid);
    await cleanupEvolutionData(sb, { runIds, strategyIds, promptIds });
  }, 60000);

  function seedRow(runId: string): Record<string, unknown> {
    return {
      id: randomUUID(),
      run_id: runId,
      variant_content: '[TEST_EVO] seed-guard',
      elo_score: 1200,
      mu: 25,
      sigma: 8.333,
      generation: 0,
      agent_name: 'seed_variant',
      match_count: 0,
      is_winner: false,
      persisted: true,
    };
  }

  async function seedRun(): Promise<string> {
    const run = await createTestEvolutionRun(sb, null, { status: 'running' });
    const rid = run.id as string;
    runIds.push(rid);
    strategyIds.push(run.strategy_id as string);
    promptIds.push(run.prompt_id as string);
    return rid;
  }

  it('persists the seed variant when the run exists', async () => {
    if (!ok) return;
    const rid = await seedRun();
    await expect(persistSeedVariantRow(sb, rid, seedRow(rid), logger)).resolves.toBeUndefined();
    const { count } = await sb
      .from('evolution_variants')
      .select('*', { count: 'exact', head: true })
      .eq('run_id', rid)
      .eq('generation_method', 'seed');
    expect((count ?? 0)).toBeGreaterThan(0);
  }, 60000);

  it('aborts gracefully when the run was deleted mid-persist (real FK → RunDeletedDuringExecutionError)', async () => {
    if (!ok) return;
    const rid = await seedRun();
    // Simulate the parallel-teardown race: the run (and any children) are deleted, THEN the pipeline
    // tries to persist its seed variant referencing the now-gone run_id.
    await sb.from('evolution_variants').delete().eq('run_id', rid);
    await sb.from('evolution_runs').delete().eq('id', rid);
    await expect(persistSeedVariantRow(sb, rid, seedRow(rid), logger)).rejects.toBeInstanceOf(
      RunDeletedDuringExecutionError,
    );
  }, 60000);
});
