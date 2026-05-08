// Phase 5.1 — E2E test for the debate_and_generate dispatch path.
// (bring_back_debate_agent_20260506 Phase 5.1.)
//
// Mirrors admin-evolution-iterative-editing.spec.ts. Tagged @evolution so it only
// runs in the production-only E2E job, not the pre-merge gate.
//
// Asserts:
//   - Strategy with ≥2 generate iterations + 1 debate_and_generate runs to completion.
//   - Debate iteration emits ≥1 surfaced variant with agent_name='debate_then_generate_from_previous_article'.
//   - Synthesized variant's parent_variant_ids = [winner.id, loser.id] (Decision §20 order).
//   - debate_cost metric > 0.
//   - Wizard 5-tab layout renders for the debate invocation page.
//   - Wizard form-hide assertion: debate iteration form hides 8 fields per Phase 4.7.
//   - Wizard reasoning-effort dropdown is enabled for reasoning-capable judge model
//     and disabled with help-text chip for non-capable model.
//
// NOTE on multi-parent-lineage assertions: the parent_variant_ids array assertion
// depends on Phase 1.15a migration (deferred). When this E2E runs against a staging
// db that has 1.15a applied, the assertion should be enabled. Until then, the
// surfaced-variant assertion is the primary signal.

import { adminTest, expect } from '../../fixtures/admin-auth';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { trackEvolutionId } from '../../helpers/evolution-test-data-factory';

const TEST_PREFIX = '[TEST_EVO] Debate';

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// Marked describe.fixme: this whole spec is a scaffold — the full beforeAll body
// (prompt + experiment + run setup) and the per-test query bodies depend on the
// Phase 1.15a migration applying to the staging DB the E2E runner targets, plus
// run-execution machinery that's deferred per the planning doc. Leaving the spec
// in fixme state keeps the contract visible (test names + comments) without
// gating PR merges on infrastructure that isn't ready yet.
adminTest.describe.fixme('Debate + Generate Pipeline', { tag: '@evolution' }, () => {
  adminTest.describe.configure({ mode: 'serial' });
  adminTest.setTimeout(360_000);

  // Scaffold placeholders — full setup follows admin-evolution-iterative-editing.spec.ts
  // template; populated in beforeAll once strategy/experiment/run rows are inserted.
  // Initialized to '' so TS strict's "used-before-assigned" check stays happy in the
  // tests' query helpers. The test bodies treat empty string as a placeholder; full
  // E2E run wires these from real DB inserts.
  let strategyId: string = '';
  const runId: string = '';

  adminTest.beforeAll(async () => {
    // Per-test timeout already configured via adminTest.setTimeout(360_000) at the
    // describe level; no need to set it again here.
    const sb = getServiceClient();

    // Strategy: 2× generate → debate. Debate cannot be first iteration (canBeFirstIteration
    // returns false per Phase 1.1 + Decision §16) so we need pool ≥ 2 first.
    const { data: strategy, error: stratErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${TEST_PREFIX} Strategy`,
        config_hash: `e2e-debate-${Date.now()}`,
        config: {
          generationModel: 'gpt-4.1-nano',
          judgeModel: 'qwen-2.5-7b-instruct',
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 30 },
            { agentType: 'generate', budgetPercent: 30 },
            { agentType: 'debate_and_generate', budgetPercent: 40 },
          ],
          maxComparisonsPerVariant: 5,
        } as unknown as Database['public']['Tables']['evolution_strategies']['Insert']['config'],
      })
      .select('id')
      .single();
    if (stratErr || !strategy) throw new Error(`Strategy create failed: ${stratErr?.message}`);
    strategyId = strategy.id;
    trackEvolutionId('strategy', strategyId);

    // Prompt + experiment + run setup elided — mirrors editing spec template.
    // (Full setup follows admin-evolution-iterative-editing.spec.ts; omitted here
    // for brevity since this scaffold's purpose is to assert the debate-specific
    // contracts once the full E2E machinery is invoked.)
  });

  adminTest('debate iteration produces surfaced variant with correct agent_name', async () => {
    const sb = getServiceClient();
    // After run completes, find the debate-synthesized variant.
    const { data: invocations } = await sb
      .from('evolution_agent_invocations')
      .select('id, agent_name, success, execution_detail')
      .eq('run_id', runId)
      .eq('agent_name', 'debate_then_generate_from_previous_article');
    expect(invocations).toBeDefined();
    expect(invocations!.length).toBeGreaterThanOrEqual(1);
    const debateInv = invocations![0]!;
    expect(debateInv.agent_name).toBe('debate_then_generate_from_previous_article');
    // execution_detail should have the V2 Option-C shape.
    const detail = debateInv.execution_detail as Record<string, unknown> | null;
    expect(detail?.detailType).toBe('debate_then_generate_from_previous_article');
    expect(detail?.tactic).toBe('debate_synthesis');
  });

  // Multi-parent assertion (parent_variant_ids = [winner, loser] per Decision §20)
  // is deferred — it depends on the Phase 1.15a migration. When staging has the
  // migration applied, restore this test (mirror the variant_count check shape).

  adminTest('debate_cost metric > 0', async () => {
    const sb = getServiceClient();
    const { data: metrics } = await sb
      .from('evolution_metrics')
      .select('value')
      .eq('entity_type', 'run')
      .eq('entity_id', runId)
      .eq('metric_name', 'debate_cost');
    expect(metrics).toBeDefined();
    expect(metrics!.length).toBeGreaterThanOrEqual(1);
    expect((metrics![0]!.value as number)).toBeGreaterThan(0);
  });

  adminTest('wizard 5-tab layout renders for debate invocation page', async ({ page }) => {
    const sb = getServiceClient();
    const { data: inv } = await sb
      .from('evolution_agent_invocations')
      .select('id')
      .eq('run_id', runId)
      .eq('agent_name', 'debate_then_generate_from_previous_article')
      .limit(1)
      .single();
    expect(inv).toBeDefined();
    await page.goto(`/admin/evolution/invocations/${inv!.id}`);
    // 5 tabs per Phase 4.3.
    await expect(page.getByText('Debate Overview')).toBeVisible();
    await expect(page.getByText('Synthesis')).toBeVisible();
    await expect(page.getByText('Metrics')).toBeVisible();
    await expect(page.getByText('Timeline')).toBeVisible();
    await expect(page.getByText('Logs')).toBeVisible();
  });

  adminTest('wizard form-hide assertion: debate iteration hides 8 fields (Phase 4.7)', async ({ page }) => {
    await page.goto('/admin/evolution/strategies/new');
    // Step 1 → fill required fields → Step 2.
    // (Setup-fill omitted — full coverage in dedicated wizard spec; this scaffold pins
    // the form-hide contract.)
    // After agentType=debate_and_generate selected:
    //   - generationGuidance / reflectionTopN / criteriaIds / weakestK /
    //     editingMaxCycles / editingCutoffMode / editingCutoffValue /
    //     sourceMode / qualityCutoff fields must NOT be in the DOM for that iteration.
    // (Full assertion deferred — testid plumbing on each field exists, this scaffold
    // documents the contract.)
    expect(true).toBe(true);
  });

  adminTest('wizard reasoning-effort dropdown enabled for reasoning-capable judge', async () => {
    // judgeModel='qwen/qwen3-8b' (supportsReasoning=true) → dropdown enabled.
    // judgeModel='gpt-4.1-nano' (false) → dropdown disabled with help-text chip.
    // Full assertion deferred to wizard testid coverage.
    expect(true).toBe(true);
  });

  adminTest.afterAll(async () => {
    const sb = getServiceClient();
    await sb.from('evolution_strategies').delete().eq('id', strategyId);
    // experimentId / runId / promptId cleanup follows the iterative-editing template.
  });
});
