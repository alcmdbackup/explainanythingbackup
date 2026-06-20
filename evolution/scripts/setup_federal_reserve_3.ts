#!/usr/bin/env npx tsx
// Phase 5 setup script: create the "Federal Reserve 3 — top 5-10% only" arena topic
// and seed it with 5-10 variants drawn from Federal Reserve 2's 5-10% percentile band.
// Idempotent: both topic creation (step 1) and seed insertion (step 3) guard with
// WHERE NOT EXISTS so a re-run is a strict no-op once the first run succeeded.
//
// Usage:
//   npx tsx evolution/scripts/setup_federal_reserve_3.ts            # apply
//   npx tsx evolution/scripts/setup_federal_reserve_3.ts --dry-run  # print what would happen
//   MIN_SEEDS=3 npx tsx evolution/scripts/setup_federal_reserve_3.ts # lower the seed-count floor (default 5)

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const NEW_TOPIC_NAME = 'Federal Reserve 3 — top 5-10% only';
const SOURCE_TOPIC_NAME = 'Federal Reserve 2';
const SEED_LIMIT = 8;
const MIN_SEEDS = Number(process.env.MIN_SEEDS ?? '5');

interface SourceVariantRow {
  id: string;
  variant_content: string;
  mu: number | string | null;
  sigma: number | string | null;
  elo_score: number | null;
  pct_from_top: number;
}

async function main(): Promise<void> {
  const db = createClient(SUPABASE_URL!, SERVICE_KEY!);

  // Step 0: resolve the source topic.
  const { data: sourceTopic, error: sourceErr } = await db
    .from('evolution_prompts')
    .select('id, prompt, prompt_kind')
    .eq('name', SOURCE_TOPIC_NAME)
    .single();
  if (sourceErr || !sourceTopic) {
    console.error(`Could not find source topic "${SOURCE_TOPIC_NAME}":`, sourceErr?.message);
    process.exit(1);
  }
  console.log(`Source topic ${SOURCE_TOPIC_NAME} resolved: id=${sourceTopic.id}, prompt_kind=${sourceTopic.prompt_kind ?? '(null)'}`);

  // Step 1: idempotent topic creation. WHERE NOT EXISTS guard means re-runs are no-ops.
  let newTopicId: string;
  const { data: existing } = await db
    .from('evolution_prompts')
    .select('id')
    .eq('name', NEW_TOPIC_NAME)
    .maybeSingle();

  if (existing) {
    newTopicId = existing.id as string;
    console.log(`Topic "${NEW_TOPIC_NAME}" already exists (id=${newTopicId}). Continuing to check seed state.`);
  } else if (dryRun) {
    console.log(`[dry-run] Would insert evolution_prompts row { name: "${NEW_TOPIC_NAME}", prompt: <copied from ${SOURCE_TOPIC_NAME}>, prompt_kind: ${sourceTopic.prompt_kind ?? '(null)'} }`);
    newTopicId = 'dry-run-placeholder';
  } else {
    const { data: created, error: createErr } = await db
      .from('evolution_prompts')
      .insert({
        name: NEW_TOPIC_NAME,
        prompt: sourceTopic.prompt,
        status: 'active',
        prompt_kind: sourceTopic.prompt_kind,
      })
      .select('id')
      .single();
    if (createErr || !created) {
      console.error('Failed to create new topic:', createErr?.message);
      process.exit(1);
    }
    newTopicId = created.id as string;
    console.log(`Created topic "${NEW_TOPIC_NAME}" (id=${newTopicId}).`);
  }

  // Step 2: short-circuit if seeds already exist (idempotency guard before sampling).
  const { count: existingSeedCount } = await db
    .from('evolution_variants')
    .select('id', { count: 'exact', head: true })
    .eq('prompt_id', newTopicId)
    .eq('generation_method', 'seed');
  if ((existingSeedCount ?? 0) > 0) {
    console.log(`Topic "${NEW_TOPIC_NAME}" already has ${existingSeedCount} seeds. Re-run is a no-op.`);
    return;
  }

  // Step 3: compute the 5-10% percentile band on the source topic. Filters:
  //  - same prompt_id as source
  //  - synced_to_arena = true
  //  - archived_at IS NULL
  //  - generation_method != 'seed' (exclude FR2's own seeds — different curation tier)
  //  - elo_score IS NOT NULL (PERCENT_RANK over nullable column would skew the denominator)
  // PERCENT_RANK over ORDER BY elo_score DESC: top variant ≈ 0.0, bottom ≈ 1.0.
  // BETWEEN 0.05 AND 0.10 = 5-10% band = 90-95th percentile by elo. ORDER BY RANDOM()
  // + LIMIT 8 yields a diverse sample within the band. Supabase JS doesn't expose
  // PERCENT_RANK; use a raw RPC via the `pg` SQL function on the service client.
  const sql = `
    WITH ranked AS (
      SELECT id, variant_content, mu, sigma, elo_score,
             PERCENT_RANK() OVER (ORDER BY elo_score DESC) AS pct_from_top
      FROM evolution_variants
      WHERE prompt_id = '${sourceTopic.id}'
        AND synced_to_arena = true
        AND archived_at IS NULL
        AND generation_method <> 'seed'
        AND elo_score IS NOT NULL
    )
    SELECT id, variant_content, mu, sigma, elo_score, pct_from_top
    FROM ranked
    WHERE pct_from_top BETWEEN 0.05 AND 0.10
    ORDER BY RANDOM()
    LIMIT ${SEED_LIMIT};
  `;
  const { data: bandResult, error: bandErr } = await db.rpc('execute_select', { sql });
  if (bandErr) {
    console.error('Percentile query failed:', bandErr.message);
    console.error('Hint: this script needs a supabase RPC named `execute_select(sql text)` that runs the SELECT and returns the result set. If your supabase project does not expose one, run the SQL above directly via psql against the prod DB:');
    console.error(sql);
    process.exit(1);
  }
  const sourceRows = (bandResult ?? []) as SourceVariantRow[];

  if (sourceRows.length < MIN_SEEDS) {
    console.error(`Percentile band only yielded ${sourceRows.length} candidates (< MIN_SEEDS=${MIN_SEEDS}). Aborting — investigate the FR2 data anomaly before retrying.`);
    process.exit(2);
  }
  console.log(`Percentile band yielded ${sourceRows.length} source variants. Sample preview:`);
  for (const row of sourceRows) {
    console.log(`  id=${row.id} pct=${row.pct_from_top.toFixed(4)} elo=${row.elo_score}`);
  }

  if (dryRun) {
    console.log(`[dry-run] Would insert ${sourceRows.length} seed rows into evolution_variants for prompt_id=${newTopicId}.`);
    return;
  }

  // Step 4: insert seeds. Each inherits its source variant's mu/sigma (matches
  // EVOLUTION_REUSE_SEED_RATING=true semantics — battle-tested rating carries
  // forward into the new topic). generation_method='seed' so the leaderboard
  // surfaces them as seeds AND the pipeline picks one as parent originalText
  // (via resolveContent, which now honors strategyConfig.seedSelection).
  const insertRows = sourceRows.map((row) => ({
    prompt_id: newTopicId,
    variant_content: row.variant_content,
    generation_method: 'seed' as const,
    mu: row.mu,
    sigma: row.sigma,
    synced_to_arena: true,
  }));
  const { error: insertErr, data: insertResult } = await db
    .from('evolution_variants')
    .insert(insertRows)
    .select('id');
  if (insertErr || !insertResult) {
    console.error('Seed insert failed:', insertErr?.message);
    process.exit(1);
  }
  console.log(`Inserted ${insertResult.length} seeds into topic "${NEW_TOPIC_NAME}" (id=${newTopicId}).`);
  console.log('Setup complete. Next steps:');
  console.log(`  1. Visit /admin/evolution/arena/${newTopicId} to verify the ArenaSeedPanel shows ${insertResult.length} cards.`);
  console.log(`  2. Create a canary strategy with seedSelection: 'random' to exercise the multi-seed rotation in 5a-1.`);
  console.log('  3. Run 6+ invocations and compare eloAttrDelta vs Federal Reserve 2 baseline.');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
