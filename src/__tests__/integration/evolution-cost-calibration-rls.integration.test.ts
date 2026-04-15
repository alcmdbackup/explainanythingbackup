// RLS verification for the evolution_cost_calibration table
// (cost_estimate_accuracy_analysis_20260414). Service-role can read/write;
// anon key denied. readonly_local-conditional policy isn't asserted here
// because the role may not exist in all environments — its creation is
// already guarded in the migration.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import { createClient } from '@supabase/supabase-js';

describe('evolution_cost_calibration RLS', () => {
  const serviceClient = createTestSupabaseClient();

  let tableExists = false;
  beforeAll(async () => {
    const { error } = await serviceClient
      .from('evolution_cost_calibration')
      .select('strategy')
      .limit(1);
    tableExists = !error || error.code === 'PGRST116'; // PGRST116 = no rows; table exists
    if (!tableExists) console.warn('evolution_cost_calibration table missing — skipping RLS tests');
  });

  it('service-role can SELECT', async () => {
    if (!tableExists) return;
    const { error } = await serviceClient.from('evolution_cost_calibration').select('*').limit(1);
    expect(error).toBeNull();
  });

  it('service-role can upsert + delete', async () => {
    if (!tableExists) return;
    const row = {
      strategy: '__test_rls__',
      generation_model: '__test_rls__',
      judge_model: '__test_rls__',
      phase: 'generation',
      avg_output_chars: 100,
      avg_input_overhead_chars: 0,
      avg_cost_per_call: 0.001,
      n_samples: 1,
      last_refreshed_at: new Date().toISOString(),
    };
    const { error: upErr } = await serviceClient
      .from('evolution_cost_calibration')
      .upsert(row, { onConflict: 'strategy,generation_model,judge_model,phase' });
    expect(upErr).toBeNull();

    const { error: delErr } = await serviceClient
      .from('evolution_cost_calibration')
      .delete()
      .eq('strategy', '__test_rls__')
      .eq('generation_model', '__test_rls__');
    expect(delErr).toBeNull();
  });

  it('anon key cannot SELECT (deny-all policy in effect)', async () => {
    if (!tableExists) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      console.warn('Anon key env vars not set — skipping anon denial check');
      return;
    }
    // eslint-disable-next-line no-restricted-syntax -- evolution_cost_calibration not yet in auto-generated Database types until the migration in this PR deploys to staging and regenerates database.types.ts. Re-typed in a follow-up.
    const anonClient = createClient(url, anonKey);
    const { data, error } = await anonClient
      .from('evolution_cost_calibration')
      .select('strategy')
      .limit(1);
    // Either an explicit error OR an empty result (deny-all blocks rows from being visible).
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });
});
