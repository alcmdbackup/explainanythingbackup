#!/usr/bin/env npx tsx
/**
 * Audit script for evolution strategy configs and zombie runs.
 * Reports invalid configs and stale running/claimed runs.
 *
 * Usage:
 *   npx tsx scripts/audit-evolution-configs.ts                # Audit only (read-only)
 *   npx tsx scripts/audit-evolution-configs.ts --fix          # Archive invalid strategies + kill zombie runs
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const FIX_MODE = process.argv.includes('--fix');

async function loadValidation() {
  const { validateStrategyConfig, isTestEntry } = await import('../src/lib/evolution/core/configValidation');
  return { validateStrategyConfig, isTestEntry };
}

async function auditStrategies() {
  const { validateStrategyConfig, isTestEntry } = await loadValidation();

  console.log('\n=== Strategy Config Audit ===\n');

  const { data: strategies, error } = await supabase
    .from('strategy_configs')
    .select('id, name, status, config, created_by, run_count')
    .eq('status', 'active')
    .order('name');

  if (error) {
    console.error('Failed to fetch strategies:', error.message);
    return;
  }

  console.log(`Found ${strategies.length} active strategies\n`);

  const invalid: Array<{ id: string; name: string; errors: string[] }> = [];
  const testNamed: Array<{ id: string; name: string }> = [];

  for (const s of strategies) {
    // Check test name
    if (isTestEntry(s.name)) {
      testNamed.push({ id: s.id, name: s.name });
    }

    // Validate config
    const result = validateStrategyConfig(s.config);
    if (!result.valid) {
      invalid.push({ id: s.id, name: s.name, errors: result.errors });
    }

    const status = result.valid ? '  OK' : 'FAIL';
    const testTag = isTestEntry(s.name) ? ' [TEST]' : '';
    console.log(`${status}  ${s.name} (${s.id.slice(0, 8)}...) runs=${s.run_count}${testTag}`);
    if (!result.valid) {
      for (const err of result.errors) {
        console.log(`       └─ ${err}`);
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total active: ${strategies.length}`);
  console.log(`Invalid configs: ${invalid.length}`);
  console.log(`Test-named (filtered from dropdowns): ${testNamed.length}`);

  if (FIX_MODE && invalid.length > 0) {
    console.log(`\n--- Archiving ${invalid.length} invalid strategies ---`);
    for (const s of invalid) {
      const { error: archiveErr } = await supabase
        .from('strategy_configs')
        .update({ status: 'archived' })
        .eq('id', s.id);
      if (archiveErr) {
        console.error(`  FAILED to archive ${s.name}: ${archiveErr.message}`);
      } else {
        console.log(`  Archived: ${s.name} (${s.id.slice(0, 8)}...)`);
      }
    }
  }
}

async function auditZombieRuns() {
  console.log('\n=== Zombie Run Audit ===\n');

  // Runs stuck in 'running' or 'claimed' for more than 1 hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: zombies, error } = await supabase
    .from('content_evolution_runs')
    .select('id, status, started_at, created_at, error_message')
    .in('status', ['running', 'claimed'])
    .lt('created_at', oneHourAgo)
    .order('created_at');

  if (error) {
    console.error('Failed to fetch runs:', error.message);
    return;
  }

  if (zombies.length === 0) {
    console.log('No zombie runs found.\n');
    return;
  }

  console.log(`Found ${zombies.length} zombie runs (running/claimed for >1hr):\n`);
  for (const r of zombies) {
    const age = Math.round((Date.now() - new Date(r.created_at).getTime()) / 1000 / 60);
    console.log(`  ${r.id.slice(0, 8)}...  status=${r.status}  age=${age}min  started=${r.started_at ?? 'never'}`);
  }

  if (FIX_MODE) {
    console.log(`\n--- Killing ${zombies.length} zombie runs ---`);
    for (const r of zombies) {
      const { error: killErr } = await supabase
        .from('content_evolution_runs')
        .update({
          status: 'failed',
          error_message: 'Killed by audit script — zombie run',
          completed_at: new Date().toISOString(),
        })
        .eq('id', r.id)
        .in('status', ['running', 'claimed']);
      if (killErr) {
        console.error(`  FAILED to kill ${r.id.slice(0, 8)}...: ${killErr.message}`);
      } else {
        console.log(`  Killed: ${r.id.slice(0, 8)}...`);
      }
    }
  }
}

async function main() {
  console.log(`Mode: ${FIX_MODE ? 'FIX (will archive/kill)' : 'AUDIT ONLY (read-only)'}`);
  console.log(`DB: ${supabaseUrl}`);

  await auditStrategies();
  await auditZombieRuns();

  if (!FIX_MODE) {
    console.log('\nRun with --fix to archive invalid strategies and kill zombie runs.');
  }
  console.log('\nDone.');
}

main().catch(console.error);
