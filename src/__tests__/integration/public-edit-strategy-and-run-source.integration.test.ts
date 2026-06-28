/**
 * Integration tests for Phase 1 of build_website_for_evolutiOn_20260626:
 *   - evolution_strategies.public_visible (migration 20260627000003)
 *   - evolution_runs.run_source (migration 20260627000004)
 *
 * Auto-skips when either migration hasn't reached the staging DB yet.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { Database } from '@/lib/database.types';

const TEST_STRATEGY_NAME = `TESTEVO-public-visible-${Date.now()}`;

describe('public_visible + run_source (integration)', () => {
  let serviceClient: SupabaseClient<Database>;
  let publicVisibleApplied = true;
  let runSourceApplied = true;
  let createdStrategyId: string | null = null;
  const createdRunIds: string[] = [];

  beforeAll(async () => {
    serviceClient = createTestSupabaseClient();

    // Probe public_visible column
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const probePV = await (serviceClient.from('evolution_strategies') as any)
      .select('public_visible')
      .limit(1);
    if (probePV.error && /does not exist|Could not find/.test(probePV.error.message ?? '')) {
      publicVisibleApplied = false;
      // eslint-disable-next-line no-console
      console.warn('[skip] public_visible migration not applied — skipping that subset');
    }

    // Probe run_source column
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const probeRS = await (serviceClient.from('evolution_runs') as any)
      .select('run_source')
      .limit(1);
    if (probeRS.error && /does not exist|Could not find/.test(probeRS.error.message ?? '')) {
      runSourceApplied = false;
      // eslint-disable-next-line no-console
      console.warn('[skip] run_source migration not applied — skipping that subset');
    }
  });

  afterAll(async () => {
    for (const runId of createdRunIds) {
      await serviceClient.from('evolution_runs').delete().eq('id', runId);
    }
    if (createdStrategyId) {
      await serviceClient.from('evolution_strategies').delete().eq('id', createdStrategyId);
    }
  });

  it('public_visible column defaults to false on insert', async () => {
    if (!publicVisibleApplied) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceClient.from('evolution_strategies') as any)
      .insert({
        name: TEST_STRATEGY_NAME,
        config: { budgetUsd: 0.001 },
        config_hash: `test-hash-${Date.now()}`,
      })
      .select('id, public_visible')
      .single();
    expect(error).toBeNull();
    createdStrategyId = data.id;
    expect(data.public_visible).toBe(false);
  });

  it('can flip public_visible=true and the partial index supports the public picker query', async () => {
    if (!publicVisibleApplied || !createdStrategyId) return;

    // Flip + set status='active' so partial index predicate matches.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await (serviceClient.from('evolution_strategies') as any)
      .update({ public_visible: true, status: 'active' })
      .eq('id', createdStrategyId);
    expect(updErr).toBeNull();

    // Run the picker query that listPublicStrategiesAction issues.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceClient.from('evolution_strategies') as any)
      .select('id, name, description')
      .eq('public_visible', true)
      .eq('status', 'active');
    expect(error).toBeNull();
    expect((data as Array<{ id: string }>).some((r) => r.id === createdStrategyId)).toBe(true);
  });

  it('run_source defaults to "admin" when not specified on insert', async () => {
    if (!runSourceApplied || !createdStrategyId) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceClient.from('evolution_runs') as any)
      .insert({
        strategy_id: createdStrategyId,
        budget_cap_usd: 0.001,
        status: 'pending',
      })
      .select('id, run_source')
      .single();
    expect(error).toBeNull();
    createdRunIds.push(data!.id);
    expect(data!.run_source).toBe('admin');
  });

  it('run_source accepts the "public_edit" enum value', async () => {
    if (!runSourceApplied || !createdStrategyId) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (serviceClient.from('evolution_runs') as any)
      .insert({
        strategy_id: createdStrategyId,
        budget_cap_usd: 0.001,
        status: 'pending',
        run_source: 'public_edit',
      })
      .select('id, run_source')
      .single();
    expect(error).toBeNull();
    createdRunIds.push(data!.id);
    expect(data!.run_source).toBe('public_edit');
  });

  it('run_source CHECK rejects values outside the enum', async () => {
    if (!runSourceApplied || !createdStrategyId) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (serviceClient.from('evolution_runs') as any)
      .insert({
        strategy_id: createdStrategyId,
        budget_cap_usd: 0.001,
        status: 'pending',
        run_source: 'definitely_not_a_real_source',
      });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/run_source|check/i);
  });
});
