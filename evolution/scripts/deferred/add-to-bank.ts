// CLI script to add an existing evolution run winner to the Arena.
// Looks up the run, finds the winner variant, snapshots full metadata, and inserts the entry.

import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { addEntryToArena } from './lib/arenaUtils';

// ─── CLI Argument Parsing ────────────────────────────────────────

interface CLIArgs {
  runId: string;
  prompt: string;
  includeBaseline: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);

  function getValue(name: string): string | undefined {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  }

  function getFlag(name: string): boolean {
    return args.includes(`--${name}`);
  }

  if (getFlag('help') || args.length === 0) {
    console.log(`Usage: npx tsx scripts/add-to-bank.ts [options]

Options:
  --run-id <uuid>       Evolution run ID (required)
  --prompt <text>       Topic prompt for bank grouping (required)
  --include-baseline    Also add the baseline (seed) variant
  --help                Show this help message`);
    process.exit(0);
  }

  const runId = getValue('run-id');
  const prompt = getValue('prompt');

  if (!runId) {
    console.error('Error: --run-id is required');
    process.exit(1);
  }
  if (!prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  return { runId, prompt, includeBaseline: getFlag('include-baseline') };
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  console.log('\n┌─────────────────────────────────────────┐');
  console.log('│  Add Evolution Run to Arena               │');
  console.log('└─────────────────────────────────────────┘\n');

  // Fetch the run
  const { data: run, error: runError } = await supabase
    .from('evolution_runs')
    .select('id, explanation_id, model, status, total_cost_usd, run_summary')
    .eq('id', args.runId)
    .single();

  if (runError || !run) {
    console.error(`Error: Run not found: ${args.runId}`);
    process.exit(1);
  }

  if (run.status !== 'completed') {
    console.error(`Error: Run status is "${run.status}", expected "completed"`);
    process.exit(1);
  }

  console.log(`  Run:      ${run.id}`);
  console.log(`  Model:    ${run.model}`);
  console.log(`  Cost:     $${run.total_cost_usd?.toFixed(4) ?? 'unknown'}`);
  console.log(`  Status:   ${run.status}`);

  // Find the winner variant (highest Elo)
  const { data: variants, error: varError } = await supabase
    .from('evolution_variants')
    .select('id, content, agent_name, elo_score, generation')
    .eq('run_id', args.runId)
    .order('elo_score', { ascending: false })
    .limit(5);

  if (varError || !variants || variants.length === 0) {
    console.error('Error: No variants found for this run');
    process.exit(1);
  }

  const winner = variants[0];
  console.log(`\n  Winner variant: ${winner.id}`);
  console.log(`  Winner Elo:     ${winner.elo_score}`);
  console.log(`  Winner agent:   ${winner.agent_name}`);

  // Build metadata snapshot from run_summary
  const summary = run.run_summary as Record<string, unknown> | null;
  const metadata: Record<string, unknown> = {
    iterations: summary?.totalIterations ?? null,
    duration_seconds: summary?.durationSeconds ?? null,
    stop_reason: summary?.stopReason ?? null,
    final_phase: summary?.finalPhase ?? null,
    seed_model: run.model,
    match_stats: summary?.matchStats ?? null,
    strategy_effectiveness: summary?.strategyEffectiveness ?? null,
    top_variants_count: (summary?.topVariants as unknown[])?.length ?? null,
    winning_strategy: winner.agent_name,
    meta_feedback: summary?.metaFeedback ?? null,
  };

  // Add winner to bank
  const winnerResult = await addEntryToArena(supabase, {
    prompt: args.prompt,
    content: winner.content,
    generation_method: 'evolution_winner',
    model: run.model,
    total_cost_usd: run.total_cost_usd,
    evolution_run_id: run.id,
    evolution_variant_id: winner.id,
    metadata,
  });

  console.log(`\n  ✓ Winner added to Arena`);
  console.log(`    Topic: ${winnerResult.topic_id}`);
  console.log(`    Entry: ${winnerResult.entry_id}`);

  // Optionally add baseline
  if (args.includeBaseline) {
    const baseline = variants.find((v) => v.agent_name === 'original_baseline' || v.generation === 0);
    if (baseline) {
      const baselineResult = await addEntryToArena(supabase, {
        prompt: args.prompt,
        content: baseline.content,
        generation_method: 'evolution_baseline',
        model: run.model,
        total_cost_usd: null, // Baseline cost is the seed cost, not the full run cost
        evolution_run_id: run.id,
        evolution_variant_id: baseline.id,
        metadata: { seed_model: run.model },
      });

      console.log(`  ✓ Baseline added to Arena`);
      console.log(`    Entry: ${baselineResult.entry_id}`);
    } else {
      console.warn('  ⚠ No baseline variant found in this run');
    }
  }

  console.log();
}

main().catch((error) => {
  console.error('Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
