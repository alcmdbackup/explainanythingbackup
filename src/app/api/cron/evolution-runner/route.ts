// Evolution runner cron — thin wrapper around shared core logic.
// Called by Vercel cron every 5 minutes. Auth via CRON_SECRET header.

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { claimAndExecuteEvolutionRun } from '@evolution/services/evolutionRunnerCore';
import { v4 as uuidv4 } from 'uuid';

export const maxDuration = 800;

const RUNNER_ID = `cron-runner-${uuidv4().slice(0, 8)}`;
const PIPELINE_MAX_DURATION_MS = (maxDuration - 60) * 1000;

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const result = await claimAndExecuteEvolutionRun({
    runnerId: RUNNER_ID,
    maxDurationMs: PIPELINE_MAX_DURATION_MS,
  });

  if (!result.claimed) {
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      status: 'ok',
      message: 'No pending runs',
      timestamp: new Date().toISOString(),
    });
  }

  if (result.error) {
    return NextResponse.json({
      status: 'error',
      message: 'Pipeline execution failed',
      runId: result.runId,
      error: result.error,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }

  return NextResponse.json({
    status: 'ok',
    message: result.stopReason === 'continuation_timeout' ? 'Run yielded for continuation' : 'Run completed',
    runId: result.runId,
    stopReason: result.stopReason,
    durationMs: result.durationMs,
    timestamp: new Date().toISOString(),
  });
}
