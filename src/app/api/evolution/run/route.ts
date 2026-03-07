// Unified evolution runner endpoint.
// GET: called by Vercel cron (auth via CRON_SECRET).
// POST: called by admin UI (auth via session cookie, optional targetRunId).

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteEvolutionRun } from '@evolution/services/evolutionRunnerCore';
import { logger } from '@/lib/server_utilities';
import { v4 as uuidv4 } from 'uuid';

export const maxDuration = 800;

const PIPELINE_MAX_DURATION_MS = (maxDuration - 60) * 1000;

// ─── Auth: cron secret OR admin session ──────────────────────────

async function authenticateRequest(request: Request): Promise<
  { authorized: true; runnerId: string } | { authorized: false; response: NextResponse }
> {
  // Try cron secret first (fast, no DB call)
  const cronError = requireCronAuth(request);
  if (!cronError) {
    return { authorized: true, runnerId: `cron-runner-${uuidv4().slice(0, 8)}` };
  }

  // Fall back to admin session
  try {
    await requireAdmin();
    return { authorized: true, runnerId: 'admin-trigger' };
  } catch {
    return {
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
}

// ─── Shared handler ──────────────────────────────────────────────

async function handleRun(request: Request, targetRunId?: string): Promise<NextResponse> {
  const auth = await authenticateRequest(request);
  if (!auth.authorized) return auth.response;

  const result = await claimAndExecuteEvolutionRun({
    runnerId: auth.runnerId,
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

// ─── GET: cron (no targetRunId) ──────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // Cron is disabled by default — evolution runs are handled by the local minicomputer.
  // Set EVOLUTION_CRON_ENABLED=true in Vercel env vars to re-enable as a backup.
  if (process.env.EVOLUTION_CRON_ENABLED !== 'true') {
    return NextResponse.json({ skipped: true, reason: 'Cron disabled (EVOLUTION_CRON_ENABLED != true)' });
  }
  return handleRun(request);
}

// ─── POST: admin UI (optional targetRunId) ───────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
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
  return handleRun(request, targetRunId);
}
