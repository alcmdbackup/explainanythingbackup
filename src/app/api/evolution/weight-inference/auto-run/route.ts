// POST endpoint for auto-mode weight inference: judges one resumable CHUNK of un-judged
// LLM pairs for a session and returns { done, remaining, judged, spendUsd }. The client
// re-invokes until done. Admin-only; host-gated to the evolution host by middleware (public
// host → 404). maxDuration=300; the chunk size keeps each request inside that budget.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/services/adminAuth';
import { logger } from '@/lib/server_utilities';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { callLLM } from '@/lib/services/llms';
import { runAutoChunk, type JudgeFactory } from '@evolution/lib/weightInference/autoRun';
import {
  autoModeEnabled,
  WeightInferenceAutoCapError,
  WeightInferenceAutoDisabledError,
} from '@evolution/lib/weightInference/autoCost';

export const maxDuration = 300;

const bodySchema = z.object({ sessionId: z.string().uuid() }).strict();

export async function POST(request: NextRequest) {
  try {
    if (process.env.EVOLUTION_WEIGHT_INFERENCE_ENABLED === 'false') {
      return NextResponse.json({ error: 'Weight inference is disabled' }, { status: 403 });
    }
    if (!autoModeEnabled()) {
      return NextResponse.json({ error: 'Auto mode is disabled' }, { status: 403 });
    }

    const adminUserId = await requireAdmin();

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', issues: parsed.error.issues }, { status: 400 });
    }

    const db = await createSupabaseServiceClient();
    const costAcc = { usd: 0 };

    // The judge closure: routes through callLLM with the evolution_ call_source (evolution
    // daily budget + global spending gate), temperature/reasoning from the session, cost via
    // onUsage. An explicit E2E_TEST_MODE stub avoids real spend in CI (there is no generic
    // callLLM stub — it's per code path).
    const judgeFactory: JudgeFactory = (model, temperature, reasoning, costSink) => async (prompt: string) => {
      if (process.env.E2E_TEST_MODE === 'true') return 'A';
      const opts: Parameters<typeof callLLM>[9] = {
        onUsage: (u) => {
          costSink.usd += u.estimatedCostUsd ?? 0;
        },
      };
      if (temperature != null) opts!.temperature = temperature;
      if (reasoning) opts!.reasoningEffort = reasoning as NonNullable<typeof opts>['reasoningEffort'];
      return callLLM(
        prompt,
        'evolution_weight_inference',
        adminUserId,
        model as Parameters<typeof callLLM>[3],
        false,
        null,
        null,
        null,
        false,
        opts,
      );
    };

    const result = await runAutoChunk(db, parsed.data.sessionId, judgeFactory, costAcc);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('Unauthorized')) return NextResponse.json({ error: msg }, { status: 403 });
    if (error instanceof WeightInferenceAutoDisabledError) return NextResponse.json({ error: msg }, { status: 403 });
    if (error instanceof WeightInferenceAutoCapError) return NextResponse.json({ error: msg }, { status: 402 });
    logger.error('weight-inference auto-run API error', { error: msg, stack: error instanceof Error ? error.stack : undefined });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
