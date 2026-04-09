#!/usr/bin/env npx tsx
// Backfill propagated metrics for strategies/experiments that have completed runs but zero metrics.
// Run after deploying the Finding 11 fix (format_rejection_rate validation).
// Usage: npx tsx evolution/scripts/backfill-propagated-metrics.ts [--dry-run]

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const db = createClient(SUPABASE_URL!, SERVICE_KEY!);

  // Dynamically import propagateMetrics to avoid bundling issues
  const { propagateMetrics } = await import('../src/lib/pipeline/finalize/persistRunResults');

  // Find strategies with completed runs but no metrics
  const { data: strategies } = await db
    .from('evolution_strategies')
    .select('id, name')
    .eq('status', 'active');

  let backfilled = 0;

  for (const s of strategies ?? []) {
    // Check if strategy has completed runs
    const { data: runs } = await db
      .from('evolution_runs')
      .select('id')
      .eq('strategy_id', s.id)
      .eq('status', 'completed')
      .limit(1);

    if (!runs || runs.length === 0) continue;

    // Check if strategy has any metrics
    const { data: metrics } = await db
      .from('evolution_metrics')
      .select('id')
      .eq('entity_type', 'strategy')
      .eq('entity_id', s.id)
      .limit(1);

    if (metrics && metrics.length > 0) continue;

    if (dryRun) {
      console.log(`[DRY RUN] Would backfill strategy ${s.id} (${s.name})`);
    } else {
      console.log(`Backfilling strategy ${s.id} (${s.name})...`);
      await propagateMetrics(db, 'strategy', s.id);
    }
    backfilled++;
  }

  // Find experiments with completed runs but no metrics
  const { data: experiments } = await db
    .from('evolution_experiments')
    .select('id, name');

  for (const e of experiments ?? []) {
    const { data: runs } = await db
      .from('evolution_runs')
      .select('id')
      .eq('experiment_id', e.id)
      .eq('status', 'completed')
      .limit(1);

    if (!runs || runs.length === 0) continue;

    const { data: metrics } = await db
      .from('evolution_metrics')
      .select('id')
      .eq('entity_type', 'experiment')
      .eq('entity_id', e.id)
      .limit(1);

    if (metrics && metrics.length > 0) continue;

    if (dryRun) {
      console.log(`[DRY RUN] Would backfill experiment ${e.id} (${e.name})`);
    } else {
      console.log(`Backfilling experiment ${e.id} (${e.name})...`);
      await propagateMetrics(db, 'experiment', e.id);
    }
    backfilled++;
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Backfill complete: ${backfilled} entities ${dryRun ? 'would be' : ''} processed.`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
