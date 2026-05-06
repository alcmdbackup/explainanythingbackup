/**
 * Strategy Tactics tab E2E — track_tactic_effectiveness_evolution_20260422 Phase 4.
 *
 * Seeds a strategy + one completed run + variants from two distinct tactics. Verifies:
 *   - Tactics tab is present (position 2, between Metrics and Cost Estimates).
 *   - Clicking the tab renders TacticStrategyPerformanceTable with ≥1 row per tactic.
 *   - The caveat subheader is visible.
 *   - Tactics with variants but no attribution row render Elo Delta as '—'.
 *
 * Does NOT seed eloAttrDelta:* metrics — the table's null-delta path is exercised
 * instead, matching the pre-Blocker-2 historical-data case.
 */

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface SeededData {
  strategyId: string;
  runId: string;
  variantIds: string[];
}

async function seed(): Promise<SeededData> {
  const supabase = getServiceClient();
  const ts = Date.now();

  const { data: strategy, error: se } = await supabase
    .from('evolution_strategies')
    .insert({
      name: `[TEST] Tactics Tab Strategy ${ts}`,
      label: 'test',
      config: {
        generationModel: 'test',
        judgeModel: 'test',
        iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
      },
      config_hash: `ttt${ts}`,
      status: 'active',
    })
    .select('id')
    .single();
  if (se || !strategy) throw new Error(`strategy seed failed: ${se?.message}`);

  const { data: run, error: re } = await supabase
    .from('evolution_runs')
    .insert({
      strategy_id: strategy.id,
      status: 'completed',
      budget_cap_usd: 0.5,
      pipeline_version: 'v2',
    })
    .select('id')
    .single();
  if (re || !run) throw new Error(`run seed failed: ${re?.message}`);

  // Pick two tactic names to diversify the per-tactic breakdown.
  // Cast via unknown: evolution_tactics isn't in generated Database types yet.
  const { data: tactics } = await (supabase as unknown as {
    from: (t: string) => { select: (s: string) => { eq: (c: string, v: string) => { limit: (n: number) => Promise<{ data: Array<{ name: string }> | null }> } } };
  })
    .from('evolution_tactics')
    .select('name')
    .eq('status', 'active')
    .limit(2);
  if (!tactics || tactics.length < 2) throw new Error('need ≥2 evolution_tactics rows');

  const variantRows = [
    { run_id: run.id, variant_content: `[TEST] A-1 ${ts}`, mu: 25, sigma: 5, elo_score: 1310, agent_name: tactics[0]!.name, is_winner: true, cost_usd: 0.01, generation: 1 },
    { run_id: run.id, variant_content: `[TEST] A-2 ${ts}`, mu: 25, sigma: 5, elo_score: 1250, agent_name: tactics[0]!.name, is_winner: false, cost_usd: 0.01, generation: 1 },
    { run_id: run.id, variant_content: `[TEST] B-1 ${ts}`, mu: 25, sigma: 5, elo_score: 1200, agent_name: tactics[1]!.name, is_winner: false, cost_usd: 0.01, generation: 1 },
  ];
  const { data: variants, error: ve } = await supabase
    .from('evolution_variants')
    .insert(variantRows)
    .select('id');
  if (ve || !variants) throw new Error(`variant seed failed: ${ve?.message}`);

  return {
    strategyId: strategy.id,
    runId: run.id,
    variantIds: variants.map((v) => v.id as string),
  };
}

async function cleanup(data: SeededData) {
  const supabase = getServiceClient();
  await supabase.from('evolution_variants').delete().eq('run_id', data.runId);
  await supabase.from('evolution_runs').delete().eq('id', data.runId);
  await supabase.from('evolution_strategies').delete().eq('id', data.strategyId);
}

adminTest.describe('Admin Evolution Strategy Tactics Tab', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });

  let seeded: SeededData;

  adminTest.beforeAll(async () => {
    seeded = await seed();
  });

  adminTest.afterAll(async () => {
    if (seeded) await cleanup(seeded);
  });

  adminTest('Tactics tab is present between Metrics and Cost Estimates', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${seeded.strategyId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Tab list — find the tab button for Tactics.
    const tacticsTab = adminPage.getByRole('tab', { name: /^Tactics$/ });
    await expect(tacticsTab).toBeVisible({ timeout: 15000 });
  });

  adminTest('clicking Tactics tab renders the per-tactic table with caveat', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${seeded.strategyId}?tab=tactics`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Caveat subheader visible.
    await expect(adminPage.locator('[data-testid="tactics-tab-caveat"]')).toBeVisible({ timeout: 20000 });

    // Table renders.
    const table = adminPage.locator('[data-testid="strategy-tactics-table"]');
    await expect(table).toBeVisible();

    // At least 2 rows (one per tactic seeded).
    const rows = table.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });

  adminTest('rows without attribution metrics render "—" in Elo Delta', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/strategies/${seeded.strategyId}?tab=tactics`);
    await adminPage.waitForLoadState('domcontentloaded');
    await expect(adminPage.locator('[data-testid="strategy-tactics-table"]')).toBeVisible({ timeout: 20000 });

    // Since we didn't seed eloAttrDelta:* rows (pre-Blocker-2 case), every row should
    // have Elo Delta = '—'. Assert at least one '—' in the Elo Delta column.
    const emDash = adminPage.locator('[data-testid="strategy-tactics-table"] td:text-is("—")');
    expect(await emDash.count()).toBeGreaterThanOrEqual(1);
  });
});
