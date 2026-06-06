// POST endpoint for the prompt-playground: runs N single-call rewrite configs over one shared
// input and returns raw outputs + per-config cost. Admin-only; host-gated to the evolution host
// by middleware (public host → 404). maxDuration=300 gives headroom for slow models.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/services/adminAuth';
import { logger } from '@/lib/server_utilities';
import { getEvolutionModelIds } from '@/config/modelRegistry';
import {
  runPlayground,
  PlaygroundCostCapError,
  PLAYGROUND_MAX_CONFIGS,
} from '@evolution/lib/playground/runPlayground';
import type { PlaygroundRunInput } from '@evolution/lib/playground/types';

export const maxDuration = 300;

const articlePromptSchema = z.object({
  preamble: z.string().max(20_000),
  instructions: z.string().max(20_000),
}).strict();

const paragraphPromptSchema = z.object({
  directive: z.string().max(20_000),
}).strict();

const configSchema = z.object({
  label: z.string().min(1).max(80),
  prompt: z.union([articlePromptSchema, paragraphPromptSchema]),
  model: z.enum(getEvolutionModelIds() as [string, ...string[]]),
  temperature: z.number().min(0).max(2).optional(),
}).strict();

const bodySchema = z.object({
  unit: z.enum(['article', 'paragraph']),
  sourceText: z.string().min(1).max(200_000),
  title: z.string().max(500).optional(),
  configs: z.array(configSchema).min(1).max(PLAYGROUND_MAX_CONFIGS),
}).strict().superRefine((data, ctx) => {
  // The prompt shape must match the unit.
  data.configs.forEach((c, i) => {
    const isArticlePrompt = 'instructions' in c.prompt;
    if (data.unit === 'article' && !isArticlePrompt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['configs', i, 'prompt'], message: "article unit requires { preamble, instructions }" });
    }
    if (data.unit === 'paragraph' && isArticlePrompt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['configs', i, 'prompt'], message: "paragraph unit requires { directive }" });
    }
  });
});

export async function POST(request: NextRequest) {
  try {
    if (process.env.EVOLUTION_PLAYGROUND_ENABLED === '0') {
      return NextResponse.json({ error: 'Prompt playground is disabled' }, { status: 403 });
    }

    await requireAdmin();

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

    const result = await runPlayground(parsed.data as PlaygroundRunInput);
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('Unauthorized')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    if (error instanceof PlaygroundCostCapError) {
      return NextResponse.json({ error: msg, estimatedUsd: error.estimatedUsd, capUsd: error.capUsd }, { status: 402 });
    }
    logger.error('Prompt playground API error', { error: msg, stack: error instanceof Error ? error.stack : undefined });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
