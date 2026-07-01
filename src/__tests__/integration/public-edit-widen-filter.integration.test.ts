/**
 * Integration tests for improvements_to_edit_page_evolution_20260630 Phase 1:
 * PUBLIC_EDIT_WIDEN_FILTER env-gated filter + mock-model exclusion + cache
 * invalidation on status changes.
 *
 * Rule 16: seeds hermetic strategies with unique per-test names; cleans up
 * via afterAll cascade delete.
 */

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listPublicStrategiesAction,
  invalidatePublicStrategiesCache,
} from '@evolution/services/strategyRegistryActions';
import { evolutionTablesExist } from '@evolution/testing/evolution-test-helpers';

const TEST_SUFFIX = `${Date.now()}-widenfilter`;

async function seedStrategy(
  supabase: SupabaseClient,
  overrides: {
    name: string;
    status?: 'active' | 'archived';
    publicVisible?: boolean;
    generationModel?: string;
    budgetUsd?: number;
    isTestContent?: boolean;
  },
): Promise<string> {
  const config = {
    generationModel: overrides.generationModel ?? 'gpt-4.1-mini',
    judgeModel: 'qwen-2.5-7b-instruct',
    iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
    budgetUsd: overrides.budgetUsd ?? 0.05,
  };
  // Hash irrelevant — using a stable per-test suffix to keep unique
  const configHash = `test-${TEST_SUFFIX}-${overrides.name.slice(0, 20)}-${Math.random().toString(36).slice(2, 8)}`;
  const row = {
    name: overrides.name,
    label: overrides.name,
    description: null,
    config,
    config_hash: configHash,
    pipeline_type: 'v2',
    status: overrides.status ?? 'active',
    created_by: 'integration-test',
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public_visible: overrides.publicVisible ?? true,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('evolution_strategies') as any)
    .insert(row)
    .select('id, is_test_content')
    .single();
  if (error) throw error;
  // If we wanted is_test_content=true and the trigger didn't set it (name pattern didn't match),
  // manually flip it. Trigger only auto-flags patterns matching [TEST], [E2E], etc.
  if (overrides.isTestContent && !data.is_test_content) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('evolution_strategies') as any)
      .update({ is_test_content: true })
      .eq('id', data.id);
  }
  return data.id;
}

describe('public-edit widen filter integration', () => {
  let supabase: SupabaseClient;
  let tablesExist = false;
  const seededIds: string[] = [];
  const origEnv = process.env.PUBLIC_EDIT_WIDEN_FILTER;

  beforeAll(async () => {
    supabase = createTestSupabaseClient();
    tablesExist = await evolutionTablesExist(supabase);
    if (!tablesExist) return;
  });

  afterAll(async () => {
    if (!tablesExist) return;
    // Cascade-safe: delete strategies (evolution_runs FK has ON DELETE RESTRICT
    // but we never created runs here — only strategy rows).
    if (seededIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('evolution_strategies') as any).delete().in('id', seededIds);
    }
    if (origEnv === undefined) delete process.env.PUBLIC_EDIT_WIDEN_FILTER;
    else process.env.PUBLIC_EDIT_WIDEN_FILTER = origEnv;
  });

  it('widen=false: returns only public_visible active non-test non-mock strategies', async () => {
    if (!tablesExist) return;
    delete process.env.PUBLIC_EDIT_WIDEN_FILTER;
    await invalidatePublicStrategiesCache();

    const strategyIds = {
      publicRealActive: await seedStrategy(supabase, { name: `[E2E_INLINE_WIDEN_1_${TEST_SUFFIX}] public real active` }),
      privateRealActive: await seedStrategy(supabase, {
        name: `[E2E_INLINE_WIDEN_2_${TEST_SUFFIX}] private real active`,
        publicVisible: false,
      }),
      publicMockActive: await seedStrategy(supabase, {
        name: `[E2E_INLINE_WIDEN_3_${TEST_SUFFIX}] public mock active`,
        generationModel: 'mock',
      }),
      publicRealArchived: await seedStrategy(supabase, {
        name: `[E2E_INLINE_WIDEN_4_${TEST_SUFFIX}] public real archived`,
        status: 'archived',
      }),
    };
    seededIds.push(...Object.values(strategyIds));

    // Wait for the cache-invalidation from our seeds to settle by re-invalidating
    // explicitly (we're not going through the actions that call it).
    await invalidatePublicStrategiesCache();

    const result = await listPublicStrategiesAction();
    if (!result?.success || !result.data) {
      throw new Error(`listPublicStrategiesAction returned failure: ${JSON.stringify(result?.error)}`);
    }

    const returnedIds = new Set(result.data.map((s) => s.id));
    expect(returnedIds.has(strategyIds.publicRealActive)).toBe(true);
    expect(returnedIds.has(strategyIds.privateRealActive)).toBe(false);   // widen=false requires public_visible
    expect(returnedIds.has(strategyIds.publicMockActive)).toBe(false);    // mock model excluded always
    expect(returnedIds.has(strategyIds.publicRealArchived)).toBe(false);  // archived excluded always
  });

  it('widen=true: also includes non-public_visible active real strategies', async () => {
    if (!tablesExist) return;
    process.env.PUBLIC_EDIT_WIDEN_FILTER = 'true';
    await invalidatePublicStrategiesCache();

    const result = await listPublicStrategiesAction();
    if (!result?.success || !result.data) {
      throw new Error(`listPublicStrategiesAction returned failure: ${JSON.stringify(result?.error)}`);
    }

    const returnedIds = new Set(result.data.map((s) => s.id));
    // Get IDs from previous test's seeded strategies — beforeEach doesn't reset them.
    // Find them by matching names.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allSeeded } = await (supabase.from('evolution_strategies') as any)
      .select('id, name, public_visible, status, config')
      .in('id', seededIds);
    const byName = new Map<string, string>();
    for (const row of allSeeded ?? []) byName.set(row.name, row.id);

    const publicRealActiveId = Array.from(byName.entries()).find(([n]) => n.includes('public real active') && !n.includes('archived'))?.[1];
    const privateRealActiveId = Array.from(byName.entries()).find(([n]) => n.includes('private real active'))?.[1];
    const publicMockActiveId = Array.from(byName.entries()).find(([n]) => n.includes('public mock active'))?.[1];

    expect(returnedIds.has(publicRealActiveId!)).toBe(true);
    expect(returnedIds.has(privateRealActiveId!)).toBe(true);   // NEW: widen=true accepts non-public
    expect(returnedIds.has(publicMockActiveId!)).toBe(false);   // mock still excluded
  });

  it('returns budgetUsd on each row (Phase 1 widening of PublicStrategySummary)', async () => {
    if (!tablesExist) return;
    process.env.PUBLIC_EDIT_WIDEN_FILTER = 'true';
    await invalidatePublicStrategiesCache();

    const result = await listPublicStrategiesAction();
    if (!result?.success || !result.data) {
      throw new Error(`listPublicStrategiesAction returned failure: ${JSON.stringify(result?.error)}`);
    }
    for (const row of result.data) {
      expect(typeof row.budgetUsd).toBe('number');
      expect(row.budgetUsd).toBeGreaterThanOrEqual(0);
    }
  });
});
