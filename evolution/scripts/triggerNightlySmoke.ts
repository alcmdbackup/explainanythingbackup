// Layer-3 nightly smoke trigger for evolution.
// reduce_e2e_testing_llm_costs_20260621 Phase 3.
//
// Inserts a single pending run pointing at the fixed `Nightly smoke fixture`
// strategy (seeded by 20260621000002_evolution_nightly_smoke_fixture.sql), waits
// for the minicomputer's systemd runner to pick it up via queue claim, and
// asserts:
//   - run.status transitions to 'completed' within --poll-minutes (default 15)
//   - ≥1 row in evolution_variants for the run with non-empty variant_content
//   - SUM(cost_usd) for the run ≤ --max-cost (default $0.05)
//
// Fixture strategy is `is_test_content=false` (name does NOT match
// evolution_is_test_name regex), so the new claim gate lets the queue claim
// proceed without needing `allow_test_execution=true`.
//
// Args:
//   --poll-minutes N    max wait (default 15)
//   --max-cost N        max cost USD (default 0.05)
//   --prompt-text "..." prompt body (default 'Explain quantum tunneling in two sentences.')

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

const FIXTURE_STRATEGY_ID = '00000000-0000-4f00-8f00-000000000fff';

function arg(name: string): string | undefined {
  const a = process.argv.find(x => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return undefined;
  if (a.includes('=')) return a.split('=')[1];
  const idx = process.argv.indexOf(a);
  return process.argv[idx + 1];
}

async function emit(o: Record<string, unknown>): Promise<void> {
  console.log(JSON.stringify(o, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(o).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
    await import('fs').then(fs => fs.promises.appendFile(process.env.GITHUB_OUTPUT!, lines.join('\n') + '\n'));
  }
}

async function main(): Promise<void> {
  const pollMinutes = Number(arg('poll-minutes') ?? 15);
  const maxCost = Number(arg('max-cost') ?? 0.05);
  const promptText = arg('prompt-text') ?? 'Explain quantum tunneling in two sentences.';
  if (!Number.isFinite(pollMinutes) || pollMinutes < 1) {
    console.error(`Invalid --poll-minutes: ${pollMinutes}`);
    process.exit(2);
  }
  if (!Number.isFinite(maxCost) || maxCost <= 0) {
    console.error(`Invalid --max-cost: ${maxCost}`);
    process.exit(2);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(2);
  }
  const db = createClient<Database>(url, key);

  const stratCheck = await db
    .from('evolution_strategies')
    .select('id, name')
    .eq('id', FIXTURE_STRATEGY_ID)
    .maybeSingle();
  if (stratCheck.error) {
    console.error('Strategy lookup failed:', stratCheck.error.message);
    process.exit(1);
  }
  if (!stratCheck.data) {
    console.error(`Fixture strategy ${FIXTURE_STRATEGY_ID} missing. Did 20260621000002 apply to staging?`);
    process.exit(1);
  }
  console.log(`Fixture strategy present: ${stratCheck.data.name}`);

  const promptInsert = await db
    .from('evolution_prompts')
    .insert({
      prompt: promptText,
      name: `Nightly smoke prompt ${new Date().toISOString()}`,
    })
    .select('id')
    .single();
  if (promptInsert.error || !promptInsert.data) {
    console.error('Prompt insert failed:', promptInsert.error?.message);
    process.exit(1);
  }
  const promptId = promptInsert.data.id as string;
  console.log(`Inserted prompt ${promptId}`);

  const runInsert = await db
    .from('evolution_runs')
    .insert({
      strategy_id: FIXTURE_STRATEGY_ID,
      prompt_id: promptId,
      status: 'pending',
    })
    .select('id')
    .single();
  if (runInsert.error || !runInsert.data) {
    console.error('Run insert failed:', runInsert.error?.message);
    process.exit(1);
  }
  const runId = runInsert.data.id as string;
  console.log(`Inserted run ${runId}; polling for completion...`);

  const deadline = Date.now() + pollMinutes * 60_000;
  let finalStatus: string | null = null;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 30_000));
    const probe = await db.from('evolution_runs').select('status').eq('id', runId).single();
    if (probe.error) {
      console.error('Poll failed:', probe.error.message);
      continue;
    }
    finalStatus = probe.data?.status ?? null;
    const remainingMs = deadline - Date.now();
    console.log(`  status=${finalStatus} (${Math.round(remainingMs / 1000)}s remaining)`);
    if (finalStatus === 'completed' || finalStatus === 'failed' || finalStatus === 'cancelled') break;
  }

  if (finalStatus !== 'completed') {
    await emit({ run_id: runId, status: finalStatus ?? 'timeout', ok: false, reason: `did not reach completed within ${pollMinutes}m` });
    process.exit(1);
  }

  const variants = await db
    .from('evolution_variants')
    .select('id, variant_content')
    .eq('run_id', runId);
  if (variants.error) {
    console.error('Variants query failed:', variants.error.message);
    process.exit(1);
  }
  const variantRows = variants.data ?? [];
  const nonEmpty = variantRows.filter(v => typeof v.variant_content === 'string' && v.variant_content.trim().length > 0);
  if (nonEmpty.length === 0) {
    await emit({ run_id: runId, status: 'completed', variants: variantRows.length, ok: false, reason: 'no variants with non-empty variant_content' });
    process.exit(1);
  }

  const invocations = await db
    .from('evolution_agent_invocations')
    .select('cost_usd')
    .eq('run_id', runId);
  if (invocations.error) {
    console.error('Invocations query failed:', invocations.error.message);
    process.exit(1);
  }
  const totalCost = (invocations.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  if (totalCost > maxCost) {
    await emit({ run_id: runId, status: 'completed', variants: nonEmpty.length, cost_usd: totalCost, max_cost: maxCost, ok: false, reason: `cost exceeded max` });
    process.exit(1);
  }

  await emit({ run_id: runId, status: 'completed', variants: nonEmpty.length, cost_usd: totalCost, max_cost: maxCost, ok: true });
}

main().catch(e => {
  console.error('nightly smoke fatal:', e);
  process.exit(1);
});
