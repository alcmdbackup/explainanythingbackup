// Shared cron auth helper — fail-closed when CRON_SECRET is not configured.
// Used by all cron route handlers to prevent unauthorized access.

import { NextResponse } from 'next/server';

/**
 * Validates cron endpoint authorization. Returns null if auth passes,
 * or a NextResponse error if auth fails.
 *
 * Fail-closed: returns 500 if CRON_SECRET env var is not set.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
