// Backfill prompt_id and strategy_config_id on content_evolution_runs.
// prompt_id: (1) via article_bank_entries.topic_id, (2) via explanation title match.
// strategy_config_id: hash run config JSONB → find or create matching strategy_configs row.

import { createHash } from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

// ─── Strategy hash (inlined to avoid Next.js path alias deps) ───

interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;
  iterations: number;
  budgetCaps: Record<string, number>;
}

function sortKeys<V>(obj: Record<string, V>): Record<string, V> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

function hashStrategyConfig(config: StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    agentModels: config.agentModels ? sortKeys(config.agentModels) : null,
    iterations: config.iterations,
    budgetCaps: sortKeys(config.budgetCaps),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
}

function labelStrategyConfig(config: StrategyConfig): string {
  const shorten = (m: string): string => m.replace('gpt-', '').replace('deepseek-', 'ds-').replace('claude-', 'cl-');
  const parts = [`Gen: ${shorten(config.generationModel)}`, `Judge: ${shorten(config.judgeModel)}`, `${config.iterations} iters`];
  if (config.agentModels && Object.keys(config.agentModels).length > 0) {
    parts.push(`Overrides: ${Object.entries(config.agentModels).map(([k, v]) => `${k}=${shorten(v)}`).join(', ')}`);
  }
  return parts.join(' | ');
}

// ─── Backfill: prompt_id ────────────────────────────────────────

/** Backfill prompt_id on runs that don't have one yet. Exported for tests. */
export async function backfillPromptIds(
  supabase: SupabaseClient,
): Promise<{ linked: number; unlinked: number }> {
  const { data: runs, error: runsErr } = await supabase
    .from('content_evolution_runs')
    .select('id, explanation_id')
    .is('prompt_id', null);

  if (runsErr) throw new Error(`Failed to fetch runs: ${runsErr.message}`);
  if (!runs || runs.length === 0) return { linked: 0, unlinked: 0 };

  let linked = 0;

  for (const run of runs) {
    // Strategy 1: Via article_bank_entries.topic_id
    const { data: bankEntry } = await supabase
      .from('article_bank_entries')
      .select('topic_id')
      .eq('evolution_run_id', run.id)
      .limit(1)
      .single();

    if (bankEntry?.topic_id) {
      await supabase.from('content_evolution_runs')
        .update({ prompt_id: bankEntry.topic_id })
        .eq('id', run.id);
      linked++;
      continue;
    }

    // Strategy 2: Via explanation title → article_bank_topics.prompt
    if (run.explanation_id) {
      const { data: explanation } = await supabase
        .from('explanations')
        .select('explanation_title')
        .eq('id', run.explanation_id)
        .single();

      if (explanation?.explanation_title) {
        const { data: topic } = await supabase
          .from('article_bank_topics')
          .select('id')
          .ilike('prompt', explanation.explanation_title.trim())
          .is('deleted_at', null)
          .single();

        if (topic) {
          await supabase.from('content_evolution_runs')
            .update({ prompt_id: topic.id })
            .eq('id', run.id);
          linked++;
          continue;
        }
      }
    }

    console.warn(`Run ${run.id}: no prompt match found`);
  }

  return { linked, unlinked: runs.length - linked };
}

// ─── Backfill: strategy_config_id ───────────────────────────────

/** Backfill strategy_config_id by hashing run config JSONB. Exported for tests. */
export async function backfillStrategyConfigIds(
  supabase: SupabaseClient,
): Promise<{ linked: number; created: number; unlinked: number }> {
  const { data: runs, error: runsErr } = await supabase
    .from('content_evolution_runs')
    .select('id, config')
    .is('strategy_config_id', null);

  if (runsErr) throw new Error(`Failed to fetch runs: ${runsErr.message}`);
  if (!runs || runs.length === 0) return { linked: 0, created: 0, unlinked: 0 };

  let linked = 0;
  let created = 0;

  for (const run of runs) {
    const cfg = run.config as Record<string, unknown> | null;
    if (!cfg || !cfg.generationModel || !cfg.judgeModel || !cfg.iterations || !cfg.budgetCaps) {
      console.warn(`Run ${run.id}: missing required config fields, skipping strategy backfill`);
      continue;
    }

    const stratConfig: StrategyConfig = {
      generationModel: cfg.generationModel as string,
      judgeModel: cfg.judgeModel as string,
      agentModels: (cfg.agentModels as Record<string, string>) ?? undefined,
      iterations: cfg.iterations as number,
      budgetCaps: cfg.budgetCaps as Record<string, number>,
    };
    const configHash = hashStrategyConfig(stratConfig);

    // Try to find existing strategy with same hash
    const { data: existing } = await supabase
      .from('strategy_configs')
      .select('id')
      .eq('config_hash', configHash)
      .limit(1)
      .single();

    let strategyId: string;

    if (existing) {
      strategyId = existing.id;
      linked++;
    } else {
      // Create new auto-strategy from config
      const label = labelStrategyConfig(stratConfig);
      const { data: inserted, error: insertErr } = await supabase
        .from('strategy_configs')
        .insert({
          config_hash: configHash,
          name: `Auto: ${label}`,
          label,
          config: stratConfig,
          is_predefined: false,
          run_count: 1,
        })
        .select('id')
        .single();

      if (insertErr || !inserted) {
        console.warn(`Run ${run.id}: failed to create strategy — ${insertErr?.message}`);
        continue;
      }
      strategyId = inserted.id;
      created++;
    }

    await supabase.from('content_evolution_runs')
      .update({ strategy_config_id: strategyId })
      .eq('id', run.id);
  }

  return { linked, created, unlinked: runs.length - linked - created };
}

// ─── CLI entry point ─────────────────────────────────────────────

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Backfilling prompt_id...');
  const promptResult = await backfillPromptIds(supabase);
  console.log(`  prompt_id: ${promptResult.linked} linked, ${promptResult.unlinked} unlinked`);

  console.log('Backfilling strategy_config_id...');
  const stratResult = await backfillStrategyConfigIds(supabase);
  console.log(`  strategy_config_id: ${stratResult.linked} linked, ${stratResult.created} created, ${stratResult.unlinked} unlinked`);

  // Summary
  const totalUnlinked = promptResult.unlinked + stratResult.unlinked;
  if (totalUnlinked > 0) {
    console.warn(`\n⚠ ${totalUnlinked} run(s) still have NULL FKs. Migration 000008 will fail until resolved.`);
    process.exit(1);
  }

  console.log('\nBackfill complete. All runs linked — migration 000008 is safe to apply.');
}

// Only run main when executed directly (not imported by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
