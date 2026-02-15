// Evolution watchdog cron endpoint — marks stale runs (heartbeat > 10 min) as failed.
// Designed to be called by GitHub Actions every 15 minutes or via Vercel cron.

import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { logger } from '@/lib/server_utilities';
import { requireCronAuth } from '@/lib/utils/cronAuth';

// SCRIPT-4: Configurable via env; defaults to 10 minutes
const STALE_THRESHOLD_MINUTES = parseInt(process.env.STALE_THRESHOLD_MINUTES ?? '10', 10) || 10;

export async function GET(request: Request): Promise<NextResponse> {
  // Verify cron secret — fail-closed when CRON_SECRET is not configured
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const supabase = await createSupabaseServiceClient();

    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    const { data: staleRuns, error: fetchError } = await supabase
      .from('content_evolution_runs')
      .select('id, runner_id, last_heartbeat, current_iteration, phase')
      .in('status', ['claimed', 'running'])
      .lt('last_heartbeat', cutoff);

    if (fetchError) {
      logger.error('Watchdog fetch error', { error: fetchError.message });
      return NextResponse.json({ error: 'Failed to query stale runs' }, { status: 500 });
    }

    if (!staleRuns || staleRuns.length === 0) {
      return NextResponse.json({
        status: 'ok',
        staleRunsFound: 0,
        timestamp: new Date().toISOString(),
      });
    }

    const staleIds = staleRuns.map((r) => r.id);
    const { error: updateError } = await supabase
      .from('content_evolution_runs')
      .update({
        status: 'failed',
        error_message: `Stale heartbeat — runner presumed crashed (threshold: ${STALE_THRESHOLD_MINUTES}min)`,
        runner_id: null,
      })
      .in('id', staleIds);

    if (updateError) {
      logger.error('Watchdog update error', { error: updateError.message, staleIds });
      return NextResponse.json({ error: 'Failed to update stale runs' }, { status: 500 });
    }

    logger.warn('Watchdog marked stale runs as failed', {
      count: staleRuns.length,
      runIds: staleIds,
    });

    return NextResponse.json({
      status: 'ok',
      staleRunsFound: staleRuns.length,
      markedFailed: staleIds,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Watchdog unexpected error', { error: String(error) });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
