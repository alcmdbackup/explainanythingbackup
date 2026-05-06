// POST endpoint to trigger an evolution pipeline run. Admin-only, used by E2E tests and manual triggers.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteRun } from '@evolution/lib/pipeline/claimAndExecuteRun';
import { logger } from '@/lib/server_utilities';
import {
  GlobalBudgetExceededError,
  LLMKillSwitchError,
} from '@/lib/errors/serviceError';
import { BudgetExceededError } from '@evolution/lib/types';

export const maxDuration = 300;

// B079: validate the POST body so malformed JSON / unexpected fields fail loudly with 400
// instead of silently passing `undefined` to claimAndExecuteRun. `.strict()` rejects extras
// so that any caller sending additional fields is forced through the B079 caller audit.
const runRequestSchema = z.object({
  targetRunId: z.string().uuid().optional(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    // B079: parse + validate the body. An empty/absent body is equivalent to
    // `{}` (the endpoint has no required fields); malformed JSON is a 400.
    let body: unknown = {};
    let readError = false;
    let text: string | null = null;
    try {
      text = await request.text();
    } catch {
      readError = true;
    }
    if (!readError && text && text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: 'Invalid JSON body' },
          { status: 400 },
        );
      }
    }
    const parsed = runRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await claimAndExecuteRun({
      runnerId: `api-${randomUUID()}`,
      targetRunId: parsed.data.targetRunId,
      maxDurationMs: 240_000,
    });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // B081: categorize errors so callers get an appropriate status code instead of
    // a generic 500. Previously every non-Unauthorized error collapsed to 500.
    if (msg.startsWith('Unauthorized')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    if (error instanceof LLMKillSwitchError) {
      logger.warn('Evolution run blocked by LLM kill switch', { error: msg });
      return NextResponse.json(
        { error: 'LLM kill switch is enabled; all LLM calls are blocked' },
        { status: 503 },
      );
    }
    if (error instanceof GlobalBudgetExceededError) {
      logger.warn('Evolution run blocked by global budget cap', { error: msg });
      return NextResponse.json(
        { error: 'Daily or monthly LLM budget exceeded', detail: msg },
        { status: 402 },
      );
    }
    if (error instanceof BudgetExceededError) {
      logger.warn('Evolution run blocked by per-run budget', { error: msg });
      return NextResponse.json(
        { error: 'Per-run budget exceeded', detail: msg },
        { status: 402 },
      );
    }
    logger.error('Evolution run API error', { error: msg, stack: error instanceof Error ? error.stack : undefined });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
