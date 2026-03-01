// Cron route to clean up orphaned LLM budget reservations from crashed serverless instances.
// Runs every 5 minutes via Vercel cron.

import { NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/utils/cronAuth';
import { getSpendingGate } from '@/lib/services/llmSpendingGate';
import { logger } from '@/lib/server_utilities';

export const maxDuration = 30;

export async function GET(request: Request): Promise<NextResponse> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const gate = getSpendingGate();
    await gate.cleanupOrphanedReservations();
    return NextResponse.json({ status: 'ok', message: 'Orphaned reservations reset' });
  } catch (error) {
    logger.error('Failed to reset orphaned reservations', { error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
