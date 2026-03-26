// Quick debug script to query evolution run 3345a6ab from staging DB
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // 1. Find the run
  const { data: runs, error: runError } = await supabase
    .from('evolution_runs')
    .select('id,status,strategy_id,budget_cap_usd,error_message,run_summary,completed_at,created_at')
    .eq('id', '3345a6ab-7662-4e5c-be1e-724934fa6d38');

  if (runError) { console.error('Run query error:', runError); return; }
  if (!runs?.length) { console.error('No runs found matching 3345a6ab*'); return; }

  const run = runs[0]!;
  console.log('\n=== RUN ===');
  console.log('ID:', run.id);
  console.log('Status:', run.status);
  console.log('Budget:', run.budget_cap_usd);
  console.log('Error:', run.error_message);
  console.log('Completed:', run.completed_at);

  if (run.run_summary) {
    const s = run.run_summary as Record<string, unknown>;
    console.log('\n=== RUN SUMMARY ===');
    console.log('Stop reason:', s.stopReason);
    console.log('Total iterations:', s.totalIterations);
    console.log('Match stats:', JSON.stringify(s.matchStats));
    console.log('Top variants:', JSON.stringify(s.topVariants, null, 2));
    console.log('Strategy effectiveness:', JSON.stringify(s.strategyEffectiveness, null, 2));
  }

  // 2. Get variants
  const { data: variants, error: varError } = await supabase
    .from('evolution_variants')
    .select('id,elo_score,mu,sigma,generation,agent_name,match_count,is_winner,synced_to_arena')
    .eq('run_id', run.id)
    .order('elo_score', { ascending: false });

  if (varError) { console.error('Variant query error:', varError); return; }
  console.log('\n=== VARIANTS ===');
  console.log(`Count: ${variants?.length}`);
  variants?.forEach((v) => {
    console.log(`  ${v.id.slice(0, 8)} | elo=${v.elo_score} mu=${v.mu} sigma=${v.sigma} matches=${v.match_count} gen=${v.generation} agent=${v.agent_name} winner=${v.is_winner} arena=${v.synced_to_arena}`);
  });

  // 3. Get invocations
  const { data: invocations, error: invError } = await supabase
    .from('evolution_agent_invocations')
    .select('id,agent_name,iteration,success,skipped,cost_usd,error_message,duration_ms')
    .eq('run_id', run.id)
    .order('iteration', { ascending: true })
    .order('execution_order', { ascending: true });

  if (invError) { console.error('Invocation query error:', invError); return; }
  console.log('\n=== INVOCATIONS ===');
  invocations?.forEach((inv) => {
    console.log(`  iter=${inv.iteration} agent=${inv.agent_name} success=${inv.success} skipped=${inv.skipped} cost=$${inv.cost_usd} duration=${inv.duration_ms}ms error=${inv.error_message || 'none'}`);
  });

  // 4. Get error/warn logs
  const { data: logs, error: logError } = await supabase
    .from('evolution_logs')
    .select('level,agent_name,message,context,iteration')
    .eq('run_id', run.id)
    .in('level', ['warn', 'error'])
    .order('created_at', { ascending: true });

  if (logError) { console.error('Log query error:', logError); return; }
  console.log('\n=== WARN/ERROR LOGS ===');
  logs?.forEach((log) => {
    console.log(`  [${log.level}] iter=${log.iteration} agent=${log.agent_name}: ${log.message}`);
    if (log.context) console.log(`    context: ${JSON.stringify(log.context)}`);
  });
}

main().catch(console.error);
