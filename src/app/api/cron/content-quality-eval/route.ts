// Nightly cron endpoint — evaluates articles without recent quality scores.
// Feature-flagged via content_quality_eval_enabled. Called by Vercel cron or GitHub Actions.

import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { requireCronAuth } from '@/lib/utils/cronAuth';

const MAX_ARTICLES_PER_RUN = 20;
const STALE_DAYS = 30; // re-evaluate articles older than 30 days
const AUTO_QUEUE_THRESHOLD = 0.4; // articles scoring below this get auto-queued for evolution

export async function GET(request: Request): Promise<NextResponse> {
  // Verify cron secret — fail-closed when CRON_SECRET is not configured
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = await createSupabaseServiceClient();

    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('name', 'content_quality_eval_enabled')
      .single();

    if (!flag?.enabled) {
      return NextResponse.json({
        status: 'skipped',
        reason: 'content_quality_eval_enabled flag is disabled',
        timestamp: new Date().toISOString(),
      });
    }

    // Find articles without recent scores
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: allExplanations } = await supabase
      .from('explanations')
      .select('id')
      .eq('status', 'published')
      .order('id', { ascending: true });

    if (!allExplanations?.length) {
      return NextResponse.json({
        status: 'ok',
        articlesQueued: 0,
        reason: 'No published explanations found',
        timestamp: new Date().toISOString(),
      });
    }

    const { data: recentScores } = await supabase
      .from('content_quality_scores')
      .select('explanation_id')
      .gt('created_at', cutoff);

    const recentIds = new Set((recentScores ?? []).map((r) => r.explanation_id));

    const needsEval = allExplanations
      .filter((e) => !recentIds.has(e.id))
      .slice(0, MAX_ARTICLES_PER_RUN)
      .map((e) => e.id);

    if (needsEval.length === 0) {
      return NextResponse.json({
        status: 'ok',
        articlesQueued: 0,
        reason: 'All articles have recent scores',
        timestamp: new Date().toISOString(),
      });
    }

    // Run batch eval
    const { runContentQualityBatch } = await import('@/lib/services/contentQualityEval');

    const runId = await runContentQualityBatch(
      needsEval,
      'cron-eval',
      undefined, // use default dimensions
      'cron',
    );

    logger.info('Content quality eval cron completed', {
      runId,
      articlesQueued: needsEval.length,
    });

    // Phase E: Auto-queue low-scoring articles for evolution (if both flags enabled)
    let autoQueued = 0;
    const { data: evolutionFlag } = await supabase
      .from('feature_flags')
      .select('enabled')
      .eq('name', 'evolution_pipeline_enabled')
      .single();

    if (evolutionFlag?.enabled) {
      autoQueued = await autoQueueLowScoringArticles(supabase);
    }

    return NextResponse.json({
      status: 'ok',
      articlesQueued: needsEval.length,
      autoQueuedForEvolution: autoQueued,
      runId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Content quality eval cron error', { error: String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

// ─── Phase E: Auto-queue low-scoring articles for evolution ──────

async function autoQueueLowScoringArticles(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
): Promise<number> {
  try {
    // Get latest "overall" scores per article
    const { data: scores } = await supabase
      .from('content_quality_scores')
      .select('explanation_id, score, created_at')
      .eq('dimension', 'overall')
      .order('created_at', { ascending: false });

    if (!scores || scores.length === 0) return 0;

    const latestByArticle = new Map<number, number>();
    for (const s of scores) {
      if (!latestByArticle.has(s.explanation_id)) {
        latestByArticle.set(s.explanation_id, s.score);
      }
    }

    const lowScoring = Array.from(latestByArticle.entries())
      .filter(([, score]) => score < AUTO_QUEUE_THRESHOLD)
      .map(([id]) => id);

    if (lowScoring.length === 0) return 0;

    // Check which already have pending/running evolution runs
    const { data: existingRuns } = await supabase
      .from('content_evolution_runs')
      .select('explanation_id')
      .in('explanation_id', lowScoring)
      .in('status', ['pending', 'claimed', 'running']);

    const alreadyQueued = new Set((existingRuns ?? []).map((r) => r.explanation_id));

    // Queue the rest
    const toQueue = lowScoring.filter((id) => !alreadyQueued.has(id)).slice(0, 5);

    if (toQueue.length === 0) return 0;

    const inserts = toQueue.map((explanationId) => ({
      explanation_id: explanationId,
      budget_cap_usd: 3.00, // conservative budget for auto-queued
    }));

    const { error } = await supabase
      .from('content_evolution_runs')
      .insert(inserts);

    if (error) {
      logger.error('Auto-queue insert failed', { error: error.message });
      return 0;
    }

    logger.info('Auto-queued low-scoring articles for evolution', {
      count: toQueue.length,
      explanationIds: toQueue,
    });

    return toQueue.length;
  } catch (error) {
    logger.error('Auto-queue failed', { error: String(error) });
    return 0;
  }
}
