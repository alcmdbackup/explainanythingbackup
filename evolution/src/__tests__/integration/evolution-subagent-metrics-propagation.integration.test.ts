// Integration test for the 3-level write pattern in computeSubagentMetrics.
//
// rename_agents_subagents_evolution_20260508 Phase 3. Pins that the per-level
// `if (opts.strategyId)` / `if (opts.experimentId)` gates write rows to the
// correct entity_type rows in evolution_metrics — and ONLY those rows.
//
// Catches bugs like flipping each per-level `if` gate, AND-ing them, or
// duplicating one branch's payload to another — none of which the all-set /
// none-set cases alone would catch.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { computeRunMetrics } from '@evolution/lib/metrics/experimentMetrics';
import type { Database } from '@/lib/database.types';

function getServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

// computeRunMetrics accepts an untyped SupabaseClient (it constructs row queries
// against tables not present in the generated Database types). Cast at the call
// site so the seeding code can keep using the typed client.
type UntypedSb = Parameters<typeof computeRunMetrics>[1];
function asUntyped(sb: SupabaseClient<Database>): UntypedSb {
  return sb as unknown as UntypedSb;
}

interface SeedIds {
  promptId: string;
  strategyId: string;
  experimentId: string;
  runId: string;
}

async function seedRunFixture(sb: SupabaseClient<Database>, label: string): Promise<SeedIds> {
  const prefix = `e2e-subagent-prop-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: prompt, error: pErr } = await sb
    .from('evolution_prompts')
    .insert({ prompt: `${prefix} prompt`, name: `${prefix} Prompt`, status: 'active' })
    .select('id')
    .single();
  if (pErr) throw new Error(`Seed prompt: ${pErr.message}`);

  const { data: strategy, error: sErr } = await sb
    .from('evolution_strategies')
    .insert({
      name: `${prefix}-strategy`,
      config: { maxIterations: 1 },
      config_hash: `hash-${prefix}`,
      status: 'active',
    })
    .select('id')
    .single();
  if (sErr) throw new Error(`Seed strategy: ${sErr.message}`);

  const { data: experiment, error: eErr } = await sb
    .from('evolution_experiments')
    .insert({
      name: `${prefix}-exp`,
      config: { strategies: [] },
      config_hash: `exp-hash-${prefix}`,
      status: 'active',
    })
    .select('id')
    .single();
  if (eErr) throw new Error(`Seed experiment: ${eErr.message}`);

  const runId = randomUUID();
  const { error: rErr } = await sb.from('evolution_runs').insert({
    id: runId,
    status: 'completed',
    strategy_id: strategy.id,
    prompt_id: prompt.id,
    experiment_id: experiment.id,
    budget_cap_usd: 1.0,
    completed_at: new Date().toISOString(),
  });
  if (rErr) throw new Error(`Seed run: ${rErr.message}`);

  // Reflect+Gen invocation: yields subagents reflection (LLM), generation (LLM),
  // ranking (Composite) — three named subagents we can assert on.
  const { error: invErr } = await sb.from('evolution_agent_invocations').insert({
    id: randomUUID(),
    run_id: runId,
    agent_name: 'reflect_and_generate_from_previous_article',
    iteration: 0,
    execution_order: 0,
    success: true,
    cost_usd: 0.036,
    duration_ms: 14400,
    execution_detail: {
      reflection: { cost: 0.003, durationMs: 1200, tacticChosen: 'engagement_amplify' },
      generation: { cost: 0.022, durationMs: 9000 },
      ranking: { cost: 0.011, durationMs: 4200, comparisons: [] },
    },
  });
  if (invErr) throw new Error(`Seed invocation: ${invErr.message}`);

  return {
    promptId: prompt.id,
    strategyId: strategy.id,
    experimentId: experiment.id,
    runId,
  };
}

async function cleanupFixture(sb: SupabaseClient<Database>, ids: SeedIds): Promise<void> {
  await sb.from('evolution_metrics').delete().in('entity_id', [ids.runId, ids.strategyId, ids.experimentId]);
  await sb.from('evolution_agent_invocations').delete().eq('run_id', ids.runId);
  await sb.from('evolution_runs').delete().eq('id', ids.runId);
  await sb.from('evolution_experiments').delete().eq('id', ids.experimentId);
  await sb.from('evolution_strategies').delete().eq('id', ids.strategyId);
  await sb.from('evolution_prompts').delete().eq('id', ids.promptId);
}

async function getSubagentRows(
  sb: SupabaseClient<Database>,
  entityId: string,
  entityType: 'run' | 'strategy' | 'experiment',
): Promise<Array<{ metric_name: string; value: number }>> {
  const { data, error } = await sb
    .from('evolution_metrics')
    .select('metric_name, value')
    .eq('entity_id', entityId)
    .eq('entity_type', entityType)
    .like('metric_name', 'subagent:%');
  if (error) throw new Error(`Query subagent rows: ${error.message}`);
  return data ?? [];
}

// describe.skip until branch migrations 20260509000001/2 are applied to the
// staging Supabase referenced by NEXT_PUBLIC_SUPABASE_URL. Pre-merge runs hit
// stale PostgREST schema cache (no subagent_name column). Flip to `describe`
// in CI after the post-merge supabase-migrations workflow completes.
describe.skip('subagent:*.cost 3-level write pattern (integration)', () => {
  // Each test creates+tears down its own fixture so we can run in parallel
  // without value collisions on writeMetricMax (GREATEST).

  it('writes subagent rows at run + strategy + experiment when both opts are set', async () => {
    const sb = getServiceClient();
    const ids = await seedRunFixture(sb, 'both-set');
    try {
      await computeRunMetrics(ids.runId, asUntyped(sb), { strategyId: ids.strategyId, experimentId: ids.experimentId });

      const runRows = await getSubagentRows(sb, ids.runId, 'run');
      const strategyRows = await getSubagentRows(sb, ids.strategyId, 'strategy');
      const experimentRows = await getSubagentRows(sb, ids.experimentId, 'experiment');

      expect(runRows.length).toBeGreaterThan(0);
      expect(strategyRows.length).toBe(runRows.length);
      expect(experimentRows.length).toBe(runRows.length);

      // Specific subagent names present (reflection, generation, ranking).
      const runNames = new Set(runRows.map((r) => r.metric_name));
      expect(runNames.has('subagent:reflection.cost')).toBe(true);
      expect(runNames.has('subagent:generation.cost')).toBe(true);
    } finally {
      await cleanupFixture(sb, ids);
    }
  });

  it('writes ONLY run-level rows when opts is empty', async () => {
    const sb = getServiceClient();
    const ids = await seedRunFixture(sb, 'no-opts');
    try {
      await computeRunMetrics(ids.runId, asUntyped(sb), {});

      const runRows = await getSubagentRows(sb, ids.runId, 'run');
      const strategyRows = await getSubagentRows(sb, ids.strategyId, 'strategy');
      const experimentRows = await getSubagentRows(sb, ids.experimentId, 'experiment');

      expect(runRows.length).toBeGreaterThan(0);
      expect(strategyRows.length).toBe(0);
      expect(experimentRows.length).toBe(0);
    } finally {
      await cleanupFixture(sb, ids);
    }
  });

  it('writes run + strategy when only strategyId is set (no experiment rows)', async () => {
    const sb = getServiceClient();
    const ids = await seedRunFixture(sb, 'strategy-only');
    try {
      await computeRunMetrics(ids.runId, asUntyped(sb), { strategyId: ids.strategyId });

      const runRows = await getSubagentRows(sb, ids.runId, 'run');
      const strategyRows = await getSubagentRows(sb, ids.strategyId, 'strategy');
      const experimentRows = await getSubagentRows(sb, ids.experimentId, 'experiment');

      expect(runRows.length).toBeGreaterThan(0);
      expect(strategyRows.length).toBe(runRows.length);
      expect(experimentRows.length).toBe(0);
    } finally {
      await cleanupFixture(sb, ids);
    }
  });

  it('writes run + experiment when only experimentId is set (no strategy rows)', async () => {
    const sb = getServiceClient();
    const ids = await seedRunFixture(sb, 'experiment-only');
    try {
      await computeRunMetrics(ids.runId, asUntyped(sb), { experimentId: ids.experimentId });

      const runRows = await getSubagentRows(sb, ids.runId, 'run');
      const strategyRows = await getSubagentRows(sb, ids.strategyId, 'strategy');
      const experimentRows = await getSubagentRows(sb, ids.experimentId, 'experiment');

      expect(runRows.length).toBeGreaterThan(0);
      expect(strategyRows.length).toBe(0);
      expect(experimentRows.length).toBe(runRows.length);
    } finally {
      await cleanupFixture(sb, ids);
    }
  });

  it('honors EVOLUTION_EMIT_SUBAGENT_METRICS=false kill switch', async () => {
    const sb = getServiceClient();
    const ids = await seedRunFixture(sb, 'kill-switch');
    const prev = process.env.EVOLUTION_EMIT_SUBAGENT_METRICS;
    process.env.EVOLUTION_EMIT_SUBAGENT_METRICS = 'false';
    try {
      await computeRunMetrics(ids.runId, asUntyped(sb), { strategyId: ids.strategyId, experimentId: ids.experimentId });

      const runRows = await getSubagentRows(sb, ids.runId, 'run');
      const strategyRows = await getSubagentRows(sb, ids.strategyId, 'strategy');
      const experimentRows = await getSubagentRows(sb, ids.experimentId, 'experiment');

      expect(runRows.length).toBe(0);
      expect(strategyRows.length).toBe(0);
      expect(experimentRows.length).toBe(0);
    } finally {
      if (prev === undefined) {
        delete process.env.EVOLUTION_EMIT_SUBAGENT_METRICS;
      } else {
        process.env.EVOLUTION_EMIT_SUBAGENT_METRICS = prev;
      }
      await cleanupFixture(sb, ids);
    }
  });
});
