// Backfill prompt_id and strategy_config_id on evolution_runs.
// prompt_id: (1) via evolution_arena_entries.topic_id, (2) via explanation title match.
// strategy_config_id: hash run config JSONB → find or create matching strategy_configs row.

import { createHash } from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;
  iterations: number;
  enabledAgents?: string[];
  singleArticle?: boolean;
}

/** Matches canonical hashStrategyConfig in strategyConfig.ts — only hashes
 *  generationModel, judgeModel, iterations, enabledAgents, singleArticle.
 *  agentModels are intentionally excluded. */
function hashStrategyConfig(config: StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    iterations: config.iterations,
    ...(config.enabledAgents?.length ? { enabledAgents: config.enabledAgents.slice().sort() } : {}),
    ...(config.singleArticle ? { singleArticle: true } : {}),
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

const LEGACY_PROMPT_TEXT = '[Legacy] Pre-framework runs';
const LEGACY_STRATEGY_HASH = 'legacy000000';

/** Find or create a catch-all "Legacy" prompt for unmatchable runs. */
async function getOrCreateLegacyPrompt(supabase: SupabaseClient): Promise<string> {
  const { data: existing } = await supabase
    .from('evolution_arena_topics')
    .select('id')
    .eq('prompt', LEGACY_PROMPT_TEXT)
    .is('deleted_at', null)
    .limit(1)
    .single();

  if (existing) return existing.id;

  const { data: inserted, error } = await supabase
    .from('evolution_arena_topics')
    .insert({ prompt: LEGACY_PROMPT_TEXT, difficulty_tier: 'easy', domain_tags: ['legacy'], status: 'archived' })
    .select('id')
    .single();

  if (error || !inserted) throw new Error(`Failed to create legacy prompt: ${error?.message}`);
  return inserted.id;
}

/** Find or create a catch-all "Legacy" strategy for runs with no config. */
async function getOrCreateLegacyStrategy(supabase: SupabaseClient): Promise<string> {
  const { data: existing } = await supabase
    .from('evolution_strategy_configs')
    .select('id')
    .eq('config_hash', LEGACY_STRATEGY_HASH)
    .limit(1)
    .single();

  if (existing) return existing.id;

  const legacyConfig: StrategyConfig = {
    generationModel: 'unknown',
    judgeModel: 'unknown',
    iterations: 1,
  };

  const { data: inserted, error } = await supabase
    .from('evolution_strategy_configs')
    .insert({
      config_hash: LEGACY_STRATEGY_HASH,
      name: 'Legacy (pre-framework)',
      label: 'Legacy | Pre-framework runs',
      config: legacyConfig,
      is_predefined: false,
      run_count: 0,
    })
    .select('id')
    .single();

  if (error || !inserted) throw new Error(`Failed to create legacy strategy: ${error?.message}`);
  return inserted.id;
}

function isSchemaNotReady(error: { message: string } | null): boolean {
  return !!error?.message?.includes('Could not find the table') ||
    !!error?.message?.includes('does not exist');
}

/** Backfill prompt_id on runs that don't have one yet. */
export async function backfillPromptIds(
  supabase: SupabaseClient,
): Promise<{ linked: number; unlinked: number }> {
  const { data: runs, error: runsErr } = await supabase
    .from('evolution_runs')
    .select('id, explanation_id')
    .is('prompt_id', null);

  if (runsErr) {
    if (isSchemaNotReady(runsErr)) {
      console.log('  evolution_runs table/columns not ready — skipping prompt_id backfill');
      return { linked: 0, unlinked: 0 };
    }
    throw new Error(`Failed to fetch runs: ${runsErr.message}`);
  }
  if (!runs || runs.length === 0) return { linked: 0, unlinked: 0 };

  let linked = 0;
  const unmatchedRunIds: string[] = [];

  for (const run of runs) {
    // Strategy 1: Via evolution_arena_entries.topic_id
    const { data: bankEntry } = await supabase
      .from('evolution_arena_entries')
      .select('topic_id')
      .eq('evolution_run_id', run.id)
      .limit(1)
      .single();

    if (bankEntry?.topic_id) {
      await supabase.from('evolution_runs')
        .update({ prompt_id: bankEntry.topic_id })
        .eq('id', run.id);
      linked++;
      continue;
    }

    // Strategy 2: Via explanation title → evolution_arena_topics.prompt
    if (run.explanation_id) {
      const { data: explanation } = await supabase
        .from('explanations')
        .select('explanation_title')
        .eq('id', run.explanation_id)
        .single();

      if (explanation?.explanation_title) {
        const { data: topic } = await supabase
          .from('evolution_arena_topics')
          .select('id')
          .ilike('prompt', explanation.explanation_title.trim())
          .is('deleted_at', null)
          .single();

        if (topic) {
          await supabase.from('evolution_runs')
            .update({ prompt_id: topic.id })
            .eq('id', run.id);
          linked++;
          continue;
        }
      }
    }

    unmatchedRunIds.push(run.id);
  }

  if (unmatchedRunIds.length > 0) {
    const legacyPromptId = await getOrCreateLegacyPrompt(supabase);
    for (const runId of unmatchedRunIds) {
      await supabase.from('evolution_runs')
        .update({ prompt_id: legacyPromptId })
        .eq('id', runId);
    }
    console.log(`  Assigned ${unmatchedRunIds.length} unmatched run(s) to legacy prompt`);
    linked += unmatchedRunIds.length;
  }

  return { linked, unlinked: 0 };
}

/** Backfill strategy_config_id by hashing run config JSONB. */
export async function backfillStrategyConfigIds(
  supabase: SupabaseClient,
): Promise<{ linked: number; created: number; unlinked: number }> {
  const { data: runs, error: runsErr } = await supabase
    .from('evolution_runs')
    .select('id, config')
    .is('strategy_config_id', null);

  if (runsErr) {
    if (isSchemaNotReady(runsErr)) {
      console.log('  evolution_runs table/columns not ready — skipping strategy_config_id backfill');
      return { linked: 0, created: 0, unlinked: 0 };
    }
    throw new Error(`Failed to fetch runs: ${runsErr.message}`);
  }
  if (!runs || runs.length === 0) return { linked: 0, created: 0, unlinked: 0 };

  let linked = 0;
  let created = 0;

  const unmatchedRunIds: string[] = [];

  for (const run of runs) {
    const cfg = run.config as Record<string, unknown> | null;
    if (!cfg || !cfg.generationModel || !cfg.judgeModel || !cfg.iterations) {
      unmatchedRunIds.push(run.id);
      continue;
    }

    const stratConfig: StrategyConfig = {
      generationModel: cfg.generationModel as string,
      judgeModel: cfg.judgeModel as string,
      agentModels: (cfg.agentModels as Record<string, string>) ?? undefined,
      iterations: cfg.iterations as number,
    };
    const configHash = hashStrategyConfig(stratConfig);

    const { data: existing } = await supabase
      .from('evolution_strategy_configs')
      .select('id')
      .eq('config_hash', configHash)
      .limit(1)
      .single();

    let strategyId: string;

    if (existing) {
      strategyId = existing.id;
      linked++;
    } else {
      const label = labelStrategyConfig(stratConfig);
      const { data: inserted, error: insertErr } = await supabase
        .from('evolution_strategy_configs')
        .insert({
          config_hash: configHash,
          name: `Auto: ${label}`,
          label,
          config: stratConfig,
          is_predefined: false,
          created_by: 'system',
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

    await supabase.from('evolution_runs')
      .update({ strategy_config_id: strategyId })
      .eq('id', run.id);
  }

  if (unmatchedRunIds.length > 0) {
    const legacyStrategyId = await getOrCreateLegacyStrategy(supabase);
    for (const runId of unmatchedRunIds) {
      await supabase.from('evolution_runs')
        .update({ strategy_config_id: legacyStrategyId })
        .eq('id', runId);
    }
    console.log(`  Assigned ${unmatchedRunIds.length} unmatched run(s) to legacy strategy`);
    linked += unmatchedRunIds.length;
  }

  return { linked, created, unlinked: 0 };
}

/** Mark stale pending/claimed/running runs as failed so migration 000008 can proceed. */
export async function drainStaleRuns(
  supabase: SupabaseClient,
): Promise<{ drained: number }> {
  const { data, error } = await supabase
    .from('evolution_runs')
    .update({ status: 'failed' })
    .in('status', ['pending', 'claimed', 'running'])
    .select('id');

  if (error) {
    if (isSchemaNotReady(error)) {
      console.log('  evolution_runs table/columns not ready — skipping drain');
      return { drained: 0 };
    }
    throw new Error(`Failed to drain stale runs: ${error.message}`);
  }
  return { drained: data?.length ?? 0 };
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Draining stale in-flight runs...');
  const drainResult = await drainStaleRuns(supabase);
  console.log(`  Marked ${drainResult.drained} stale run(s) as failed`);

  console.log('Backfilling prompt_id...');
  const promptResult = await backfillPromptIds(supabase);
  console.log(`  prompt_id: ${promptResult.linked} linked, ${promptResult.unlinked} unlinked`);

  console.log('Backfilling strategy_config_id...');
  const stratResult = await backfillStrategyConfigIds(supabase);
  console.log(`  strategy_config_id: ${stratResult.linked} linked, ${stratResult.created} created, ${stratResult.unlinked} unlinked`);

  const totalUnlinked = promptResult.unlinked + stratResult.unlinked;
  if (totalUnlinked > 0) {
    console.warn(`\n⚠ ${totalUnlinked} run(s) still have NULL FKs. Migration 000008 will fail until resolved.`);
    process.exit(1);
  }

  console.log('\nBackfill complete. All runs linked — migration 000008 is safe to apply.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
