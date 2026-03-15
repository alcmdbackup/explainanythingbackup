// POST-only evolution runner endpoint — triggered by admin UI.

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteEvolutionRun } from '@evolution/services/evolutionRunnerCore';
import { logger } from '@/lib/server_utilities';

export const maxDuration = 800;

const PIPELINE_MAX_DURATION_MS = (maxDuration - 60) * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let targetRunId: string | undefined;
  try {
    const body = await request.json();
    if (body.runId != null) {
      if (typeof body.runId !== 'string' || !UUID_RE.test(body.runId)) {
        return NextResponse.json({ error: 'Invalid runId — must be a UUID' }, { status: 400 });
      }
      targetRunId = body.runId;
    }
  } catch {
    // No body or unparseable JSON — treat as "run next pending"
    logger.warn('POST /api/evolution/run: no valid JSON body, treating as run-next-pending');
  }

  const result = await claimAndExecuteEvolutionRun({
    runnerId: 'admin-trigger',
    targetRunId,
    maxDurationMs: PIPELINE_MAX_DURATION_MS,
  });

  if (!result.claimed) {
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      claimed: false,
      message: 'No pending runs',
    });
  }

  if (result.error) {
    return NextResponse.json({
      claimed: true,
      runId: result.runId,
      error: result.error,
    }, { status: 500 });
  }

  return NextResponse.json({
    claimed: true,
    runId: result.runId,
    stopReason: result.stopReason,
    durationMs: result.durationMs,
  });
}
