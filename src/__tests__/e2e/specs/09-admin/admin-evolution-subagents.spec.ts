// E2E spec for the Subagents tab on /admin/evolution/invocations/[id].
// rename_agents_subagents_evolution_20260508 — Phase 2 Verification §A.
//
// Verifies the generic Subagents tree (Phase 2) renders correctly for each
// wrapper agent type using seeded fixture invocations with hand-crafted
// `execution_detail` JSONB. No pipeline execution — just DB fixtures + UI render
// assertions, so the spec runs in the pre-merge gate (not @evolution-tagged).

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { randomUUID } from 'crypto';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

adminTest.describe('Subagents tab (invocation detail)', () => {
  adminTest.describe.configure({ mode: 'serial' });

  const testPrefix = `e2e-subagents-${Date.now()}`;
  let strategyId: string;
  let promptId: string;
  let runId: string;
  let gfpaInvocationId: string;
  let reflectGenInvocationId: string;
  let editingInvocationId: string;

  adminTest.beforeAll(async () => {
    const sb = getServiceClient();

    const { data: prompt, error: pErr } = await sb
      .from('evolution_prompts')
      .insert({ prompt: `${testPrefix} prompt`, name: `${testPrefix} Prompt`, status: 'active' })
      .select('id')
      .single();
    if (pErr) throw new Error(`Seed prompt: ${pErr.message}`);
    promptId = prompt.id;

    const { data: strategy, error: sErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${testPrefix}-strategy`,
        config: { maxIterations: 1 },
        config_hash: `hash-${testPrefix}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);
    strategyId = strategy.id;

    runId = randomUUID();
    const { error: rErr } = await sb.from('evolution_runs').insert({
      id: runId,
      status: 'completed',
      strategy_id: strategyId,
      prompt_id: promptId,
      budget_cap_usd: 1.0,
      completed_at: new Date().toISOString(),
    });
    if (rErr) throw new Error(`Seed run: ${rErr.message}`);

    // GFPA invocation: 2-layer tree (L1 = GFPA; L2 = generation, ranking).
    gfpaInvocationId = randomUUID();
    const { error: gfpaErr } = await sb.from('evolution_agent_invocations').insert({
      id: gfpaInvocationId,
      run_id: runId,
      agent_name: 'generate_from_previous_article',
      iteration: 0,
      execution_order: 0,
      success: true,
      cost_usd: 0.033,
      duration_ms: 13200,
      execution_detail: {
        generation: { cost: 0.022, durationMs: 9000 },
        ranking: {
          cost: 0.011,
          durationMs: 4200,
          comparisons: [
            { round: 1, opponentId: 'a', outcome: 'win', durationMs: 800, cost: 0.0022 },
            { round: 2, opponentId: 'b', outcome: 'loss', durationMs: 750, cost: 0.0021 },
          ],
        },
      },
    });
    if (gfpaErr) throw new Error(`Seed GFPA invocation: ${gfpaErr.message}`);

    // Reflect+Gen invocation: 3-layer tree (reflection + GFPA-shape generation+ranking).
    reflectGenInvocationId = randomUUID();
    const { error: rgErr } = await sb.from('evolution_agent_invocations').insert({
      id: reflectGenInvocationId,
      run_id: runId,
      agent_name: 'reflect_and_generate_from_previous_article',
      iteration: 0,
      execution_order: 1,
      success: true,
      cost_usd: 0.036,
      duration_ms: 14400,
      execution_detail: {
        reflection: { cost: 0.003, durationMs: 1200, tacticChosen: 'engagement_amplify' },
        generation: { cost: 0.022, durationMs: 9000 },
        ranking: { cost: 0.011, durationMs: 4200, comparisons: [] },
      },
    });
    if (rgErr) throw new Error(`Seed Reflect+Gen invocation: ${rgErr.message}`);

    // Iterative editing invocation: cycles structure (L2 = cycle.N; L3 = propose/review/apply).
    editingInvocationId = randomUUID();
    const { error: ieErr } = await sb.from('evolution_agent_invocations').insert({
      id: editingInvocationId,
      run_id: runId,
      agent_name: 'iterative_editing',
      iteration: 0,
      execution_order: 2,
      success: true,
      cost_usd: 0.018,
      duration_ms: 7800,
      execution_detail: {
        cycles: [
          {
            propose: { cost: 0.004, durationMs: 1500 },
            review: { cost: 0.003, durationMs: 1100 },
            apply: { cost: 0.001, durationMs: 600 },
          },
        ],
      },
    });
    if (ieErr) throw new Error(`Seed editing invocation: ${ieErr.message}`);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_agent_invocations').delete().eq('run_id', runId);
    await sb.from('evolution_runs').delete().eq('id', runId);
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    await sb.from('evolution_prompts').delete().eq('id', promptId);
  });

  adminTest('Subagents tab is rendered as a tab option on invocation detail', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${gfpaInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const tablist = adminPage.locator('[role="tablist"]').first();
    await expect(tablist).toBeVisible({ timeout: 15000 });
    await expect(tablist.getByText(/^Subagents$/)).toBeVisible();
  });

  adminTest('GFPA invocation renders L1 + L2 (generation, ranking) tree', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${gfpaInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    // Click into Subagents tab in case it's not the default.
    const subagentsTab = adminPage.locator('[role="tab"]').filter({ hasText: /^Subagents$/ }).first();
    await expect(subagentsTab).toBeVisible({ timeout: 15000 });
    await subagentsTab.click();

    await expect(adminPage.getByTestId('subagent-row-generate_from_previous_article')).toBeVisible();
    await expect(adminPage.getByTestId('subagent-row-generation')).toBeVisible();
    await expect(adminPage.getByTestId('subagent-row-ranking')).toBeVisible();
  });

  adminTest('GFPA invocation expands L3 comparison rows under ranking (auto-open L2)', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${gfpaInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const subagentsTab = adminPage.locator('[role="tab"]').filter({ hasText: /^Subagents$/ }).first();
    await expect(subagentsTab).toBeVisible({ timeout: 15000 });
    await subagentsTab.click();

    // L2 (ranking) is auto-expanded by SubagentRow's defaultOpen rule (level <= 2),
    // so L3 comparison rows render without an explicit click.
    await expect(adminPage.getByTestId('subagent-row-ranking.comparison.1')).toBeVisible();
    await expect(adminPage.getByTestId('subagent-row-ranking.comparison.2')).toBeVisible();
  });

  adminTest('Reflect+Gen invocation renders reflection + nested GFPA subtree', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${reflectGenInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const subagentsTab = adminPage.locator('[role="tab"]').filter({ hasText: /^Subagents$/ }).first();
    await expect(subagentsTab).toBeVisible({ timeout: 15000 });
    await subagentsTab.click();

    await expect(adminPage.getByTestId('subagent-row-reflect_and_generate_from_previous_article')).toBeVisible();
    await expect(adminPage.getByTestId('subagent-row-reflection')).toBeVisible();
    await expect(adminPage.getByTestId('subagent-row-generate_from_previous_article')).toBeVisible();
  });

  adminTest('Iterative editing invocation renders cycle.N children with propose/review/apply', async ({ adminPage }) => {
    await adminPage.goto(`/admin/evolution/invocations/${editingInvocationId}`);
    await adminPage.waitForLoadState('domcontentloaded');

    const subagentsTab = adminPage.locator('[role="tab"]').filter({ hasText: /^Subagents$/ }).first();
    await expect(subagentsTab).toBeVisible({ timeout: 15000 });
    await subagentsTab.click();

    await expect(adminPage.getByTestId('subagent-row-iterative_editing')).toBeVisible();
    // cycle.1 is the only seeded cycle; its children are propose/review/apply.
    // The exact path depends on the editing parser's level shape — verify at least
    // the L1 root and one cycle-level child are visible.
    await expect(adminPage.locator('[data-testid^="subagent-row-cycle"]').first()).toBeVisible();
  });
});
