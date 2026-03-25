// POST endpoint to trigger an evolution pipeline run. Admin-only, used by E2E tests and manual triggers.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteRun } from '@evolution/lib/pipeline/claimAndExecuteRun';
import { logger } from '@/lib/server_utilities';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const result = await claimAndExecuteRun({
      runnerId: `api-${randomUUID()}`,
      targetRunId: body.targetRunId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('Unauthorized')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    logger.error('Evolution run API error', { error: msg });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
