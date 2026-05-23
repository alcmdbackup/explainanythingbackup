/**
 * Debug the variant-lineage RPC by inserting a 4-variant chain identical to
 * createMultiHopFixture and querying get_variant_full_chain. Helps narrow
 * whether the RPC works at all.
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  for (const c of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), c);
    if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing env');
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

async function main() {
  const { url, key } = loadEnv();
  const db = createClient(url, key, { auth: { persistSession: false } });

  const suffix = String(Date.now());

  // 1. Insert prompt + strategy + run
  const { data: prompt } = await db.from('evolution_prompts').insert({
    prompt: `[TEST_DEBUG] lineage debug ${suffix}`,
    name: `[TEST_DEBUG] lineage ${suffix}`,
    status: 'active',
    is_test_content: true,
  }).select('id').single();
  if (!prompt) throw new Error('prompt insert failed');
  console.log(`Inserted prompt: ${prompt.id}`);

  const { data: strategy } = await db.from('evolution_strategies').insert({
    name: `[TEST_DEBUG] lineage strategy ${suffix}`,
    config: { iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }] },
    config_hash: `debug-${suffix}`,
    status: 'active',
    is_test_content: true,
  }).select('id').single();
  if (!strategy) throw new Error('strategy insert failed');
  console.log(`Inserted strategy: ${strategy.id}`);

  const { data: run } = await db.from('evolution_runs').insert({
    strategy_id: strategy.id,
    prompt_id: prompt.id,
    status: 'completed',
    budget_cap_usd: 0.05,
  }).select('id').single();
  if (!run) throw new Error('run insert failed');
  console.log(`Inserted run: ${run.id}`);

  // 2. Variant chain: seed → v1 → v2 → leaf
  const elos = [1200, 1240, 1270, 1310];
  const mus = [0, 3, 6, 9];
  const sigmas = [5, 30, 25, 20];
  const variantIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const parent = i === 0 ? null : variantIds[i - 1];
    const { data, error } = await db
      .from('evolution_variants')
      .insert({
        run_id: run.id,
        prompt_id: prompt.id,
        parent_variant_id: parent,
        generation: i,
        variant_content: `node ${i} content`,
        elo_score: elos[i],
        mu: mus[i],
        sigma: sigmas[i],
        agent_name: i === 0 ? 'seed_variant' : 'lexical_simplify',
        persisted: true,
      })
      .select('id, parent_variant_id, generation')
      .single();
    if (error) throw new Error(`variant[${i}] insert: ${error.message}`);
    variantIds.push(data!.id);
    console.log(`Inserted variant[${i}]: ${data!.id} parent=${data!.parent_variant_id ?? 'null'} gen=${data!.generation}`);
  }

  const leafId = variantIds[variantIds.length - 1]!;
  console.log(`\nLeaf id: ${leafId}\n`);

  // 3. Call the RPC directly
  const rpcResult = await db.rpc('get_variant_full_chain' as never, { target_variant_id: leafId } as never) as unknown as { data: unknown[] | null; error: { message: string } | null };
  console.log(`RPC result: error=${rpcResult.error?.message ?? 'none'}  rows=${rpcResult.data?.length ?? 0}`);
  if (rpcResult.data && rpcResult.data.length > 0) {
    for (const row of rpcResult.data as Array<Record<string, unknown>>) {
      console.log(`  depth=${row.depth} id=${String(row.id).slice(0, 8)} gen=${row.generation} parent=${row.parent_variant_id ? String(row.parent_variant_id).slice(0, 8) : 'null'}`);
    }
  }

  // 4. Cleanup
  console.log('\nCleaning up...');
  for (const vid of variantIds) await db.from('evolution_variants').delete().eq('id', vid);
  await db.from('evolution_runs').delete().eq('id', run.id);
  await db.from('evolution_strategies').delete().eq('id', strategy.id);
  await db.from('evolution_prompts').delete().eq('id', prompt.id);
  console.log('Done.');
}

main().catch((err) => { console.error(err); process.exit(1); });
