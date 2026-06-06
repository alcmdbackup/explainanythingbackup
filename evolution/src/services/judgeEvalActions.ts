// Server actions for the Judge Lab admin tool: list pair-banks/test-sets, create a frozen
// test set, launch a settings sweep (cost-capped), and read the leaderboard + run detail.
// All judging happens in the engine via executeSweep, which enforces the hard ceiling +
// kill switch before any LLM call. Display-only with respect to evolution ratings/arena.

'use server';

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminAction, type AdminContext } from './adminAction';
import type { Database } from '@/lib/database.types';
import { getEvolutionModelIds } from '@/config/modelRegistry';
import {
  loadPairBankByName,
  loadTestSetByName,
  getOrCreateTestSet,
} from '@evolution/lib/judgeEval/persist';
import { executeSweep, type SweepOutcome } from '@evolution/lib/judgeEval/executeSweep';
import {
  kindFilterSchema,
  reasoningEffortSchema,
  testSetStrategySchema,
  type JudgeReasoningEffort,
} from '@evolution/lib/judgeEval/schemas';

function db(ctx: AdminContext): SupabaseClient<Database> {
  return ctx.supabase as SupabaseClient<Database>;
}

export const listPairBanksAction = adminAction('listPairBanks', async (ctx: AdminContext) => {
  const { data, error } = await db(ctx)
    .from('judge_eval_pair_banks')
    .select('id, name, description, source_topic_id, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  // Count pairs per bank without shipping the full JSONB to the client.
  return data ?? [];
});

export const listTestSetsAction = adminAction('listTestSets', async (ctx: AdminContext) => {
  const { data, error } = await db(ctx)
    .from('judge_eval_test_sets')
    .select('id, pair_bank_id, name, description, strategy, seed, size_article, size_paragraph, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
});

const createTestSetSchema = z.object({
  bankName: z.string().min(1),
  name: z.string().min(1).max(120),
  strategy: testSetStrategySchema,
  seed: z.number().int().default(1),
  sizeArticle: z.number().int().min(0).max(2000).default(0),
  sizeParagraph: z.number().int().min(0).max(2000).default(0),
});

export const createTestSetAction = adminAction(
  'createTestSet',
  async (input: z.input<typeof createTestSetSchema>, ctx: AdminContext) => {
    const parsed = createTestSetSchema.parse(input);
    const bank = await loadPairBankByName(db(ctx), parsed.bankName);
    if (!bank) throw new Error(`Pair-bank not found: ${parsed.bankName}`);
    const { testSet, created } = await getOrCreateTestSet(db(ctx), bank, {
      name: parsed.name,
      strategy: parsed.strategy,
      seed: parsed.seed,
      sizeArticle: parsed.sizeArticle,
      sizeParagraph: parsed.sizeParagraph,
    });
    return { testSet, created };
  },
);

const createEvalRunSchema = z.object({
  testSetName: z.string().min(1),
  kindFilter: kindFilterSchema.default('both'),
  models: z.array(z.string().min(1)).min(1).max(20),
  temperatures: z.array(z.number().min(0).max(2)).min(1).max(8),
  reasoningEfforts: z.array(reasoningEffortSchema.nullable()).min(1).max(5).default([null]),
  promptVariant: z.string().max(4000).nullable().default(null),
  explainReasoning: z.boolean().default(false),
  repeats: z.number().int().min(1).max(50).default(10),
  dryRun: z.boolean().default(false),
});

export const createEvalRunAction = adminAction(
  'createEvalRun',
  async (input: z.input<typeof createEvalRunSchema>, ctx: AdminContext): Promise<SweepOutcome> => {
    const parsed = createEvalRunSchema.parse(input);

    // Validate models against the same allow-list the Match Viewer picker uses.
    const allowed = new Set(getEvolutionModelIds());
    for (const m of parsed.models) {
      if (!allowed.has(m)) throw new Error(`Invalid judgeModel: ${m}`);
    }

    const testSet = await loadTestSetByName(db(ctx), parsed.testSetName);
    if (!testSet) throw new Error(`Test set not found: ${parsed.testSetName}`);

    const customPrompt = parsed.promptVariant?.trim() || null;

    // executeSweep enforces the hard cost ceiling + JUDGE_EVAL_ENABLED before any LLM call.
    return executeSweep(
      db(ctx),
      {
        testSetId: testSet.id,
        kindFilter: parsed.kindFilter,
        models: parsed.models,
        temperatures: parsed.temperatures,
        reasoningEfforts: parsed.reasoningEfforts as Array<JudgeReasoningEffort | null>,
        promptVariant: customPrompt,
        explainReasoning: parsed.explainReasoning,
        repeats: parsed.repeats,
      },
      { dryRun: parsed.dryRun, userId: ctx.adminUserId },
    );
  },
);

const leaderboardSchema = z.object({
  testSetId: z.string().uuid(),
  kind: z.enum(['article', 'paragraph', 'both']).default('both'),
});

export const getEvalLeaderboardAction = adminAction(
  'getEvalLeaderboard',
  async (input: z.input<typeof leaderboardSchema>, ctx: AdminContext) => {
    const parsed = leaderboardSchema.parse(input);
    let q = db(ctx)
      .from('judge_eval_settings_leaderboard')
      .select('*')
      .eq('test_set_id', parsed.testSetId)
      .order('decisive_rate', { ascending: false });
    if (parsed.kind !== 'both') q = q.eq('pair_kind', parsed.kind);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
);

const runDetailSchema = z.object({
  runId: z.string().uuid(),
  kind: z.enum(['article', 'paragraph', 'both']).default('both'),
});

export const getEvalRunDetailAction = adminAction(
  'getEvalRunDetail',
  async (input: z.input<typeof runDetailSchema>, ctx: AdminContext) => {
    const parsed = runDetailSchema.parse(input);
    const runRes = await db(ctx)
      .from('judge_eval_runs')
      .select('*')
      .eq('id', parsed.runId)
      .single();
    if (runRes.error) throw runRes.error;

    let q = db(ctx)
      .from('judge_eval_calls')
      .select('*')
      .eq('eval_run_id', parsed.runId)
      .order('pair_label', { ascending: true })
      .order('repeat_index', { ascending: true });
    if (parsed.kind !== 'both') q = q.eq('pair_kind', parsed.kind);
    const callsRes = await q;
    if (callsRes.error) throw callsRes.error;

    return { run: runRes.data, calls: callsRes.data ?? [] };
  },
);
