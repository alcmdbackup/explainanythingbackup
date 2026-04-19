// Backfill script: populates strategy_config_id for runs that have NULL.
// Extracts V2 fields from config JSONB and calls upsertStrategy() to find-or-create.
// Run BEFORE the migration that sets strategy_config_id NOT NULL.
//
// Usage: npx tsx evolution/scripts/backfill-strategy-config-id.ts [--dry-run]

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { upsertStrategy } from '../src/lib/pipeline/setup/findOrCreateStrategy';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const DRY_RUN = process.argv.includes('--dry-run');

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface RunRow {
  id: string;
  config: Record<string, unknown> | null;
}

async function main() {
  const supabase = getSupabase();

  console.log(`[backfill] Starting${DRY_RUN ? ' (DRY RUN)' : ''}...`);

  // Fetch all runs with NULL strategy_config_id
  const { data: runs, error } = await supabase
    .from('evolution_runs')
    .select('id, config')
    .is('strategy_config_id', null)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch runs: ${error.message}`);

  const rows = (runs ?? []) as RunRow[];
  console.log(`[backfill] Found ${rows.length} runs with NULL strategy_config_id`);

  if (rows.length === 0) {
    console.log('[backfill] Nothing to do.');
    return;
  }

  let backfilled = 0;
  let defaultsUsed = 0;
  const errors: Array<{ runId: string; error: string }> = [];

  for (const run of rows) {
    const config = run.config ?? {};

    const generationModel = (config.generationModel as string) ?? 'gpt-4.1-mini';
    const judgeModel = (config.judgeModel as string) ?? 'gpt-4.1-nano';
    const iterationCount = (config.maxIterations as number) ?? 5;

    // Build iterationConfigs from legacy iteration count: alternate generate/swiss pairs.
    const iterationConfigs: Array<{ agentType: 'generate' | 'swiss'; budgetPercent: number }> = [];
    {
      const totalSlots = iterationCount * 2;
      const perSlot = Math.floor(100 / totalSlots);
      let rem = 100 - perSlot * totalSlots;
      for (let i = 0; i < iterationCount; i++) {
        const genExtra = rem > 0 ? 1 : 0; if (rem > 0) rem--;
        iterationConfigs.push({ agentType: 'generate', budgetPercent: perSlot + genExtra });
        const swissExtra = rem > 0 ? 1 : 0; if (rem > 0) rem--;
        iterationConfigs.push({ agentType: 'swiss', budgetPercent: perSlot + swissExtra });
      }
    }

    const usedDefaults = !config.generationModel || !config.judgeModel || !config.maxIterations;
    if (usedDefaults) defaultsUsed++;

    try {
      if (DRY_RUN) {
        console.log(`  [dry-run] ${run.id}: gen=${generationModel} judge=${judgeModel} iter=${iterationCount}${usedDefaults ? ' (defaults)' : ''}`);
      } else {
        const strategyId = await upsertStrategy(supabase, { generationModel, judgeModel, iterationConfigs });

        const { error: updateError } = await supabase
          .from('evolution_runs')
          .update({ strategy_config_id: strategyId })
          .eq('id', run.id);

        if (updateError) throw new Error(updateError.message);

        console.log(`  [ok] ${run.id} → strategy ${strategyId}`);
      }
      backfilled++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ runId: run.id, error: msg });
      console.error(`  [error] ${run.id}: ${msg}`);
    }
  }

  console.log(`\n[backfill] Summary:`);
  console.log(`  Total runs:     ${rows.length}`);
  console.log(`  Backfilled:     ${backfilled}`);
  console.log(`  Defaults used:  ${defaultsUsed}`);
  console.log(`  Errors:         ${errors.length}`);

  if (errors.length > 0) {
    console.error('\n[backfill] Failed runs:');
    for (const e of errors) {
      console.error(`  ${e.runId}: ${e.error}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err);
  process.exit(1);
});
