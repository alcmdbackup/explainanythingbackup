// Backfill _diffMetrics into evolution_agent_invocations.execution_detail.
// Computes diffs from existing checkpoint pairs and writes into corresponding invocation rows.
// Idempotent, batched, resumable, with --dry-run mode.

import dotenv from 'dotenv';
import path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const BATCH_SIZE = 10;
const DRY_RUN = process.argv.includes('--dry-run');
const RESUME_FROM = process.argv.find(a => a.startsWith('--resume='))?.split('=')[1] ?? null;

// ─── Rating conversion (inlined to avoid Next.js path alias deps) ──

const DEFAULT_MU = 25;

function getOrdinal(r: { mu: number; sigma: number }): number {
  return r.mu - 3 * r.sigma;
}

function ordinalToEloScale(ord: number): number {
  return Math.max(0, Math.min(3000, 1200 + ord * (400 / DEFAULT_MU)));
}

function buildEloLookup(snapshot: SerializedSnapshot): Record<string, number> {
  if (snapshot.ratings && Object.keys(snapshot.ratings).length > 0) {
    return Object.fromEntries(
      Object.entries(snapshot.ratings).map(([id, r]) => [
        id,
        ordinalToEloScale(getOrdinal(r as { mu: number; sigma: number })),
      ]),
    );
  }
  if (snapshot.eloRatings && Object.keys(snapshot.eloRatings).length > 0) {
    return snapshot.eloRatings;
  }
  return {};
}

// ─── Types ──────────────────────────────────────────────────────

interface SerializedSnapshot {
  pool?: Array<{ id: string }>;
  ratings?: Record<string, { mu: number; sigma: number }>;
  eloRatings?: Record<string, number>;
  matchHistory?: unknown[];
  allCritiques?: unknown[];
  debateTranscripts?: unknown[];
  diversityScore?: number | null;
  metaFeedback?: unknown | null;
}

interface DiffMetrics {
  variantsAdded: number;
  newVariantIds: string[];
  matchesPlayed: number;
  eloChanges: Record<string, number>;
  critiquesAdded: number;
  debatesAdded: number;
  diversityScoreAfter: number | null;
  metaFeedbackPopulated: boolean;
}

interface CheckpointRow {
  iteration: number;
  last_agent: string;
  state_snapshot: SerializedSnapshot;
  created_at: string;
}

// ─── Diff computation ───────────────────────────────────────────

function computeDiff(before: SerializedSnapshot | null, after: SerializedSnapshot): DiffMetrics {
  const beforePoolIds = new Set(before?.pool?.map(v => v.id) ?? []);
  const newVariantIds = (after.pool ?? [])
    .filter(v => !beforePoolIds.has(v.id))
    .map(v => v.id);

  const beforeElo = before ? buildEloLookup(before) : {};
  const afterElo = buildEloLookup(after);

  const eloChanges: Record<string, number> = {};
  for (const [id, elo] of Object.entries(afterElo)) {
    const delta = elo - (beforeElo[id] ?? 1200);
    if (delta !== 0) eloChanges[id] = Math.round(delta * 100) / 100;
  }

  return {
    variantsAdded: newVariantIds.length,
    newVariantIds,
    matchesPlayed: Math.max(0, (after.matchHistory?.length ?? 0) - (before?.matchHistory?.length ?? 0)),
    eloChanges,
    critiquesAdded: Math.max(0, (after.allCritiques?.length ?? 0) - (before?.allCritiques?.length ?? 0)),
    debatesAdded: Math.max(0, (after.debateTranscripts?.length ?? 0) - (before?.debateTranscripts?.length ?? 0)),
    diversityScoreAfter: after.diversityScore ?? null,
    metaFeedbackPopulated: before?.metaFeedback === null && after.metaFeedback !== null,
  };
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log(`Backfill _diffMetrics${DRY_RUN ? ' (DRY RUN)' : ''}`);
  if (RESUME_FROM) console.log(`Resuming from run_id: ${RESUME_FROM}`);

  // Get all completed/failed runs, ordered by id for resumability
  let query = supabase
    .from('content_evolution_runs')
    .select('id')
    .in('status', ['completed', 'failed'])
    .order('id', { ascending: true });

  if (RESUME_FROM) {
    query = query.gt('id', RESUME_FROM);
  }

  const { data: runs, error: runsErr } = await query;
  if (runsErr) throw runsErr;
  if (!runs || runs.length === 0) {
    console.log('No runs to process');
    return;
  }

  console.log(`Found ${runs.length} runs to process`);

  let totalUpdated = 0;
  let totalSkipped = 0;

  for (let batch = 0; batch < runs.length; batch += BATCH_SIZE) {
    const batchRuns = runs.slice(batch, batch + BATCH_SIZE);
    const runIds = batchRuns.map(r => r.id);

    for (const runId of runIds) {
      const updated = await processRun(supabase, runId);
      totalUpdated += updated.updated;
      totalSkipped += updated.skipped;
    }

    console.log(`Batch ${Math.floor(batch / BATCH_SIZE) + 1}/${Math.ceil(runs.length / BATCH_SIZE)}: ` +
      `processed ${Math.min(batch + BATCH_SIZE, runs.length)}/${runs.length} runs ` +
      `(${totalUpdated} updated, ${totalSkipped} already backfilled)`);
  }

  console.log(`\nDone: ${totalUpdated} invocations updated, ${totalSkipped} already had _diffMetrics`);

  // Validation query
  if (!DRY_RUN) {
    const { count } = await supabase
      .from('evolution_agent_invocations')
      .select('*', { count: 'exact', head: true })
      .in('run_id', runs.map(r => r.id))
      .is('execution_detail->_diffMetrics', null);

    console.log(`Validation: ${count ?? 'unknown'} invocations still missing _diffMetrics`);
  }
}

async function processRun(supabase: SupabaseClient, runId: string): Promise<{ updated: number; skipped: number }> {
  // Load all checkpoints for this run, ordered by iteration + created_at
  const { data: checkpoints, error: cpErr } = await supabase
    .from('evolution_checkpoints')
    .select('iteration, last_agent, state_snapshot, created_at')
    .eq('run_id', runId)
    .order('iteration', { ascending: true })
    .order('created_at', { ascending: true });

  if (cpErr) {
    console.warn(`  Skipping run ${runId}: checkpoint query failed: ${cpErr.message}`);
    return { updated: 0, skipped: 0 };
  }
  if (!checkpoints || checkpoints.length === 0) {
    return { updated: 0, skipped: 0 };
  }

  // Load existing invocations to check for already-backfilled rows
  const { data: invocations, error: invErr } = await supabase
    .from('evolution_agent_invocations')
    .select('iteration, agent_name, execution_detail')
    .eq('run_id', runId)
    .order('iteration', { ascending: true })
    .order('execution_order', { ascending: true });

  if (invErr) {
    console.warn(`  Skipping run ${runId}: invocation query failed: ${invErr.message}`);
    return { updated: 0, skipped: 0 };
  }

  // Build map of existing invocation details
  const existingMap = new Map<string, Record<string, unknown>>();
  for (const inv of invocations ?? []) {
    existingMap.set(`${inv.iteration}-${inv.agent_name}`, (inv.execution_detail ?? {}) as Record<string, unknown>);
  }

  // Diff sequential checkpoints
  let updated = 0;
  let skipped = 0;
  let prevSnapshot: SerializedSnapshot | null = null;

  for (const cp of checkpoints as CheckpointRow[]) {
    const key = `${cp.iteration}-${cp.last_agent}`;
    const existing = existingMap.get(key);

    // Skip if already has _diffMetrics (idempotent)
    if (existing?._diffMetrics) {
      skipped++;
      prevSnapshot = cp.state_snapshot;
      continue;
    }

    const diff = computeDiff(prevSnapshot, cp.state_snapshot);

    if (!DRY_RUN && existing !== undefined) {
      // Merge _diffMetrics into existing execution_detail via jsonb_set equivalent
      const newDetail = { ...existing, _diffMetrics: diff };
      const { error: updateErr } = await supabase
        .from('evolution_agent_invocations')
        .update({ execution_detail: newDetail })
        .eq('run_id', runId)
        .eq('iteration', cp.iteration)
        .eq('agent_name', cp.last_agent);

      if (updateErr) {
        console.warn(`  Failed to update ${runId}/${key}: ${updateErr.message}`);
      } else {
        updated++;
      }
    } else if (DRY_RUN && existing !== undefined) {
      console.log(`  Would update ${runId}/${key}: +${diff.variantsAdded} variants, ${diff.matchesPlayed} matches`);
      updated++;
    }
    // Skip invocations that don't exist (checkpoint without matching invocation)

    prevSnapshot = cp.state_snapshot;
  }

  return { updated, skipped };
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
