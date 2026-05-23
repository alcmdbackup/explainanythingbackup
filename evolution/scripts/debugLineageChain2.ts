// Repro: insert 4-variant chain, immediately verify via SELECT, then call RPC.
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

for (const c of ['.env.local', '.env']) {
  const p = path.resolve(process.cwd(), c);
  if (fs.existsSync(p)) dotenv.config({ path: p, override: true });
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function main() {
  const suffix = String(Date.now());
  const { data: prompt } = await db.from('evolution_prompts').insert({
    prompt: `[TEST_DEBUG] lineage2 ${suffix}`, name: `[TEST_DEBUG] lineage2 ${suffix}`,
    status: 'active', is_test_content: true,
  }).select('id').single();
  const { data: strategy } = await db.from('evolution_strategies').insert({
    name: `[TEST_DEBUG] lineage2 ${suffix}`,
    config: { iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }] },
    config_hash: `debug2-${suffix}`, status: 'active', is_test_content: true,
  }).select('id').single();
  const { data: run } = await db.from('evolution_runs').insert({
    strategy_id: strategy!.id, prompt_id: prompt!.id, status: 'completed', budget_cap_usd: 0.05,
  }).select('id').single();

  const variantIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const parent = i === 0 ? null : variantIds[i - 1];
    const { data } = await db.from('evolution_variants').insert({
      run_id: run!.id, prompt_id: prompt!.id, parent_variant_id: parent, generation: i,
      variant_content: `node ${i}`, elo_score: 1200 + i * 30, mu: i * 3, sigma: 20,
      agent_name: i === 0 ? 'seed_variant' : 'lexical_simplify', persisted: true,
    }).select('id').single();
    variantIds.push(data!.id);
  }
  const leafId = variantIds[variantIds.length - 1]!;
  console.log(`leaf=${leafId.slice(0, 8)}`);

  // Direct SELECT to verify parent_variant_id is persisted
  console.log('\nDirect SELECT from evolution_variants:');
  const { data: rows } = await db.from('evolution_variants').select('id, parent_variant_id, generation').in('id', variantIds);
  for (const r of rows ?? []) {
    console.log(`  id=${r.id.slice(0, 8)} gen=${r.generation} parent=${r.parent_variant_id ? r.parent_variant_id.slice(0, 8) : 'null'}`);
  }

  // Call RPC
  console.log('\nRPC get_variant_full_chain (RAW):');
  const rpcResult = await db.rpc('get_variant_full_chain' as never, { target_variant_id: leafId } as never) as unknown as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
  if (rpcResult.error) console.log(`  ERROR: ${rpcResult.error.message}`);
  for (const row of rpcResult.data ?? []) {
    console.log(JSON.stringify(row));
  }

  // Cleanup
  for (const vid of variantIds) await db.from('evolution_variants').delete().eq('id', vid);
  await db.from('evolution_runs').delete().eq('id', run!.id);
  await db.from('evolution_strategies').delete().eq('id', strategy!.id);
  await db.from('evolution_prompts').delete().eq('id', prompt!.id);
}
main().catch(e => { console.error(e); process.exit(1); });
