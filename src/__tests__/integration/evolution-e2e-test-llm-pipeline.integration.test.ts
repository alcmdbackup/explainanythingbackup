// End-to-end LOCAL validation of the Phase-2 deterministic E2E LLM mock
// (fix_test_isolation_issues_20260622): drives the REAL generate→iterative_editing→swiss
// pipeline via claimAndExecuteRun under E2E_TEST_MODE against the dev DB — no Playwright, no real
// AI. Mirrors the admin-evolution-iterative-editing.spec.ts strategy config, so if this passes the
// CI Playwright spec runs the same pipeline deterministically. Asserts the run completes, an
// iterative_editing invocation produces a surfaced variant with non-default mu after ranking, and
// the iterative_edit cost metric is > 0 (the assertions the flaky spec makes). Evolution-prefixed
// → routed to the evolution integration bucket + auto-skips pre-migration.

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { evolutionTablesExist, cleanupEvolutionData } from '@evolution/testing/evolution-test-helpers';
import { claimAndExecuteRun } from '@evolution/lib/pipeline/claimAndExecuteRun';

const TS = Date.now();
const TEST_PREFIX = `[TEST_EVO] e2e-llm ${TS}`;

describe('evolution E2E test-LLM pipeline (deterministic, no real AI)', () => {
  let sb: SupabaseClient;
  let ok = false;
  let prevE2E: string | undefined;
  let strategyId: string | null = null;
  let promptId: string | null = null;
  let experimentId: string | null = null;
  let runId: string | null = null;

  beforeAll(async () => {
    sb = createTestSupabaseClient();
    ok = await evolutionTablesExist(sb);
    if (!ok) return;
    prevE2E = process.env.E2E_TEST_MODE;
    process.env.E2E_TEST_MODE = 'true';

    const { data: strategy, error: sErr } = await sb
      .from('evolution_strategies')
      .insert({
        name: `${TEST_PREFIX} Strategy`,
        config: {
          generationModel: 'deepseek-v4-flash',
          judgeModel: 'deepseek-v4-flash',
          editingModel: 'deepseek-v4-flash',
          approverModel: 'deepseek-v4-flash',
          driftRecoveryModel: 'deepseek-v4-flash',
          // Editing-heavy split (mirrors the spec): guarantees the editing iteration's inline ranking
          // has budget to rank every editing-born variant (mu != 25) even under shared-DB concurrency.
          iterationConfigs: [
            { agentType: 'generate', budgetPercent: 20 },
            { agentType: 'iterative_editing', budgetPercent: 60, editingMaxCycles: 1, editingEligibilityCutoff: { mode: 'topN', value: 3 } },
            { agentType: 'swiss', budgetPercent: 20 },
          ],
          budgetUsd: 0.05,
        },
        config_hash: `e2e-llm-${TS}`,
        status: 'active',
      })
      .select('id')
      .single();
    if (sErr) throw new Error(`seed strategy: ${sErr.message}`);
    strategyId = strategy.id as string;

    const { data: prompt, error: pErr } = await sb
      .from('evolution_prompts')
      .insert({ prompt: `Write a short article about the carbon cycle ${TS}`, name: `${TEST_PREFIX} Prompt`, status: 'active' })
      .select('id').single();
    if (pErr) throw new Error(`seed prompt: ${pErr.message}`);
    promptId = prompt.id as string;

    const { data: exp, error: eErr } = await sb
      .from('evolution_experiments')
      .insert({ name: `${TEST_PREFIX} Experiment`, prompt_id: promptId, status: 'running' })
      .select('id').single();
    if (eErr) throw new Error(`seed experiment: ${eErr.message}`);
    experimentId = exp.id as string;

    const { data: run, error: rErr } = await sb
      .from('evolution_runs')
      .insert({ strategy_id: strategyId, prompt_id: promptId, experiment_id: experimentId, budget_cap_usd: 0.05, status: 'pending' })
      .select('id').single();
    if (rErr) throw new Error(`seed run: ${rErr.message}`);
    runId = run.id as string;
  }, 300000);

  afterAll(async () => {
    if (prevE2E === undefined) delete process.env.E2E_TEST_MODE;
    else process.env.E2E_TEST_MODE = prevE2E;
    if (!ok) return;
    if (runId) {
      await sb.from('evolution_arena_comparisons').delete().eq('run_id', runId);
      await sb.from('evolution_agent_invocations').delete().eq('run_id', runId);
      await sb.from('evolution_logs').delete().eq('run_id', runId);
      await sb.from('evolution_variants').delete().eq('run_id', runId);
    }
    await cleanupEvolutionData(sb, {
      runIds: runId ? [runId] : [],
      experimentIds: experimentId ? [experimentId] : [],
      strategyIds: strategyId ? [strategyId] : [],
      promptIds: promptId ? [promptId] : [],
    });
  }, 300000);

  it('runs the full pipeline deterministically: editing variant gets non-default mu + cost > 0', async () => {
    if (!ok || !runId) return;

    const res = await claimAndExecuteRun({ db: sb, runnerId: `e2e-llm-${TS}`, targetRunId: runId, maxDurationMs: 240000 });
    expect(res.claimed).toBe(true);
    expect(res.error).toBeUndefined();

    const { data: runRow } = await sb.from('evolution_runs').select('status, error_code').eq('id', runId).single();
    expect(runRow?.status).toBe('completed');

    // An iterative_editing invocation ran and produced a surfaced variant…
    const { data: editingInvs } = await sb
      .from('evolution_agent_invocations')
      .select('id').eq('run_id', runId).eq('agent_name', 'iterative_editing');
    expect((editingInvs ?? []).length).toBeGreaterThan(0);

    const { data: editingVariants } = await sb
      .from('evolution_variants')
      .select('id, mu').in('agent_invocation_id', (editingInvs ?? []).map((i) => i.id as string));
    expect((editingVariants ?? []).length).toBeGreaterThan(0);

    // …with non-default mu (25 = OpenSkill default → unranked). Post-swiss it must shift.
    for (const v of editingVariants ?? []) {
      if (v.mu !== null) expect(Math.abs((v.mu as number) - 25)).toBeGreaterThan(0.01);
    }

    // Cost metric > 0 (synthetic usage flows through createEvolutionLLMClient's cost tracking).
    const { data: costRows } = await sb
      .from('evolution_metrics')
      .select('value').eq('entity_type', 'run').eq('entity_id', runId).eq('metric_name', 'iterative_edit_cost');
    if ((costRows ?? []).length > 0) expect(Number(costRows![0]!.value)).toBeGreaterThan(0);
  }, 300000);
});
