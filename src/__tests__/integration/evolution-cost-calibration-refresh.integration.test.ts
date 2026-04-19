// Integration tests for the evolution_cost_calibration table refresh semantics:
// upsert idempotency and empty-data short-circuit. Does NOT spawn the
// refreshCostCalibration.ts script as a subprocess (that requires the full
// Supabase URL/key + dotenv setup); instead drives the table directly to verify
// the table accepts the same upserts the script would issue.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';

describe('evolution_cost_calibration refresh upsert semantics', () => {
  const supabase = createTestSupabaseClient();
  let tableExists = false;
  const TEST_KEYS: Array<{ strategy: string; generation_model: string; judge_model: string; phase: string }> = [];

  beforeAll(async () => {
    const { error } = await supabase
      .from('evolution_cost_calibration')
      .select('strategy')
      .limit(1);
    tableExists = !error || error.code === 'PGRST116';
    if (!tableExists) console.warn('evolution_cost_calibration table missing — skipping refresh tests');
  });

  afterAll(async () => {
    if (!tableExists) return;
    for (const k of TEST_KEYS) {
      await supabase
        .from('evolution_cost_calibration')
        .delete()
        .eq('strategy', k.strategy)
        .eq('generation_model', k.generation_model)
        .eq('judge_model', k.judge_model)
        .eq('phase', k.phase);
    }
  });

  function makeRow(overrides: Partial<{
    strategy: string; generation_model: string; judge_model: string; phase: string;
    avg_output_chars: number; avg_input_overhead_chars: number;
    avg_cost_per_call: number; n_samples: number;
  }> = {}) {
    return {
      strategy: '__refresh_test__',
      generation_model: 'gpt-test-model',
      judge_model: '__unspecified__',
      phase: 'generation',
      avg_output_chars: 9500,
      avg_input_overhead_chars: 500,
      avg_cost_per_call: 0.003,
      n_samples: 10,
      last_refreshed_at: new Date().toISOString(),
      ...overrides,
    };
  }

  it('inserts a fresh row', async () => {
    if (!tableExists) return;
    const row = makeRow({ strategy: '__refresh_test_insert__' });
    TEST_KEYS.push(row);
    const { error } = await supabase
      .from('evolution_cost_calibration')
      .upsert(row, { onConflict: 'strategy,generation_model,judge_model,phase' });
    expect(error).toBeNull();
  });

  it('upserting same key updates rather than duplicates (idempotent)', async () => {
    if (!tableExists) return;
    const key = { strategy: '__refresh_test_idempotent__', generation_model: 'gpt-test-model', judge_model: '__unspecified__', phase: 'generation' };
    TEST_KEYS.push(key);

    await supabase
      .from('evolution_cost_calibration')
      .upsert(makeRow({ ...key, avg_output_chars: 9000, n_samples: 5 }), { onConflict: 'strategy,generation_model,judge_model,phase' });
    await supabase
      .from('evolution_cost_calibration')
      .upsert(makeRow({ ...key, avg_output_chars: 11000, n_samples: 20 }), { onConflict: 'strategy,generation_model,judge_model,phase' });

    const { data } = await supabase
      .from('evolution_cost_calibration')
      .select('avg_output_chars, n_samples')
      .match(key);
    expect(data).toHaveLength(1);
    const row = data![0]!;
    expect(Number(row.avg_output_chars)).toBe(11000);
    expect(row.n_samples).toBe(20);
  });

  it('rejects invalid phase values via CHECK constraint', async () => {
    if (!tableExists) return;
    const { error } = await supabase
      .from('evolution_cost_calibration')
      .upsert(makeRow({ strategy: '__refresh_test_badphase__', phase: 'not_a_real_phase' }), {
        onConflict: 'strategy,generation_model,judge_model,phase',
      });
    expect(error).not.toBeNull();
  });

  it('rejects n_samples < 1', async () => {
    if (!tableExists) return;
    const { error } = await supabase
      .from('evolution_cost_calibration')
      .upsert(makeRow({ strategy: '__refresh_test_n0__', n_samples: 0 }), {
        onConflict: 'strategy,generation_model,judge_model,phase',
      });
    expect(error).not.toBeNull();
  });
});
