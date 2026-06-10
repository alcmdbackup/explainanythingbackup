// Server actions for the Judge Lab admin tool: list pair-banks/test-sets, create a frozen
// test set, launch a settings sweep (cost-capped), and read the leaderboard + run detail.
// All judging happens in the engine via executeSweep, which enforces the hard ceiling +
// kill switch before any LLM call. Display-only with respect to evolution ratings/arena.

'use server';

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminAction, type AdminContext } from './adminAction';
import type { Database } from '@/lib/database.types';
import { getEvolutionModelIds, getDeployableEvolutionModelIds } from '@/config/modelRegistry';
import {
  loadPairBankByName,
  loadTestSetByName,
  getOrCreateTestSet,
  loadTestSetContents,
  getTestSetPairTexts,
  updateTestSetMetadata,
  cloneTestSet,
  loadBankPairsForCuration,
} from '@evolution/lib/judgeEval/persist';
import { executeSweep, type SweepOutcome } from '@evolution/lib/judgeEval/executeSweep';
import { seedPairBankFromTopic } from '@evolution/lib/judgeEval/seed';
import {
  kindFilterSchema,
  reasoningEffortSchema,
  testSetStrategySchema,
  type JudgeReasoningEffort,
  type JudgeEvalCallCore,
  type JudgeEvalCallAudit,
} from '@evolution/lib/judgeEval/schemas';

function db(ctx: AdminContext): SupabaseClient<Database> {
  return ctx.supabase as SupabaseClient<Database>;
}

// Explicit column lists for judge_eval_calls so reads NEVER `SELECT *` (which would pull the
// TOASTed heavy audit text — prompts/reasoning/raw — on every list/aggregate query). CORE is the
// light per-call row (verdict + metrics + frozen ground-truth snapshot) used by the run-detail
// aggregates and the match LIST; AUDIT is the heavy payload fetched only for a single expanded match.
const CORE_CALL_COLUMNS =
  'id, eval_run_id, pair_label, pair_kind, comparison_mode, repeat_index, forward_winner, ' +
  'reverse_winner, winner, confidence, decisive, wall_ms, fwd_ms, rev_ms, prompt_tokens, ' +
  'output_tokens, reasoning_tokens, cost_usd, error, created_at, mu_a, mu_b, sigma_a, sigma_b, ' +
  'baseline_confidence, gap_kind, expected_winner, variant_a_id, variant_b_id';
const AUDIT_CALL_COLUMNS =
  'id, forward_prompt, reverse_prompt, forward_reasoning, reverse_reasoning, forward_raw, ' +
  'reverse_raw, reasoning_trace_format';

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

/** Judge-model ids for the picker, curated server-side: excludes provider:'local' models when
 *  LOCAL_LLM_BASE_URL is unset (they'd just yield a connection error on Vercel). */
export const getJudgeModelOptionsAction = adminAction('getJudgeModelOptions', async (ctx: AdminContext) => {
  void ctx; // admin gate is applied by adminAction; no DB access needed here.
  return getDeployableEvolutionModelIds();
});

const testSetContentsSchema = z.object({
  testSetId: z.string().uuid(),
  kind: kindFilterSchema.default('both'),
});

/** View a frozen test set's contents: metadata + member pairs (Elo, no snapshot texts) + an
 *  orphan count (members no longer resolvable against a re-seeded bank). Read-only, no LLM cost. */
export const getTestSetContentsAction = adminAction(
  'getTestSetContents',
  async (input: z.input<typeof testSetContentsSchema>, ctx: AdminContext) => {
    const parsed = testSetContentsSchema.parse(input);
    return loadTestSetContents(db(ctx), parsed.testSetId, parsed.kind);
  },
);

const pairTextsSchema = z.object({
  testSetId: z.string().uuid(),
  pairLabel: z.string().min(1),
});

/** Lazy per-pair snapshot-text fetch for the contents detail page (kept out of the list to avoid
 *  shipping a large set's full texts up front). */
export const getTestSetPairTextsAction = adminAction(
  'getTestSetPairTexts',
  async (input: z.input<typeof pairTextsSchema>, ctx: AdminContext) => {
    const parsed = pairTextsSchema.parse(input);
    return getTestSetPairTexts(db(ctx), parsed.testSetId, parsed.pairLabel);
  },
);

const updateMetaSchema = z.object({
  testSetId: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
});

/** Edit test-set METADATA only (name/description). Membership-determining fields (strategy/seed/
 *  size) are intentionally not accepted — use cloneTestSetAction for a membership change. */
export const updateTestSetMetaAction = adminAction(
  'updateTestSetMeta',
  async (input: z.input<typeof updateMetaSchema>, ctx: AdminContext) => {
    const parsed = updateMetaSchema.parse(input);
    return updateTestSetMetadata(db(ctx), parsed);
  },
);

const cloneSchema = z
  .object({
    sourceTestSetId: z.string().uuid(),
    newName: z.string().min(1).max(120),
    sizeArticle: z.number().int().min(0).max(100000).optional(),
    sizeParagraph: z.number().int().min(0).max(100000).optional(),
    strategy: testSetStrategySchema.optional(),
    seed: z.number().int().optional(),
    description: z.string().max(2000).nullable().optional(),
    /** Curated clone: explicit pair labels to include (required when strategy='manual'). */
    manualLabels: z.array(z.string().min(1)).optional(),
  })
  .refine((v) => v.strategy !== 'manual' || (v.manualLabels?.length ?? 0) > 0, {
    message: 'manualLabels must be non-empty when strategy is "manual"',
    path: ['manualLabels'],
  });

/** Clone a test set into a NEW frozen set (the only safe membership-change path). Re-samples the
 *  source's CURRENT bank; preserves the source + its eval runs. With strategy='manual' + manualLabels
 *  it produces a curated set (exactly the chosen pairs). Errors on name collision. */
export const cloneTestSetAction = adminAction(
  'cloneTestSet',
  async (input: z.input<typeof cloneSchema>, ctx: AdminContext) => {
    const parsed = cloneSchema.parse(input);
    return cloneTestSet(db(ctx), parsed);
  },
);

const curationSchema = z.object({
  testSetId: z.string().uuid(),
  kind: kindFilterSchema.default('both'),
  membership: z.enum(['all', 'member', 'non_member']).default('all'),
  gapKind: z.enum(['all', 'large', 'close']).default('all'),
  search: z.string().max(200).optional(),
  eloMin: z.number().nullable().optional(),
  eloMax: z.number().nullable().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

/** List the source set's bank pairs (the curated-clone universe) with Elo + isMember flags, filtered
 *  + paginated. Powers the Clone & curate picker; the chosen labels feed cloneTestSetAction(manual). */
export const getBankPairsForCurationAction = adminAction(
  'getBankPairsForCuration',
  async (input: z.input<typeof curationSchema>, ctx: AdminContext) => {
    const parsed = curationSchema.parse(input);
    return loadBankPairsForCuration(db(ctx), parsed.testSetId, {
      kind: parsed.kind,
      membership: parsed.membership,
      gapKind: parsed.gapKind,
      search: parsed.search,
      eloMin: parsed.eloMin ?? null,
      eloMax: parsed.eloMax ?? null,
      limit: parsed.limit,
      offset: parsed.offset,
    });
  },
);

const seedSchema = z.object({
  topicId: z.string().uuid(),
  bankName: z.string().min(1).max(120),
  includeArticles: z.boolean().default(true),
  includeParagraphs: z.boolean().default(true),
});

/** Pull ALL comparison pairs from an arena topic into a (upserted) pair-bank. Read-heavy and
 *  no LLM cost. For very large topics (e.g. Federal Reserve 2 ~8.8k pairs) prefer the CLI
 *  (`judge-eval.ts seed`) to avoid the server-action time limit. */
export const seedPairBankAction = adminAction(
  'seedPairBank',
  async (input: z.input<typeof seedSchema>, ctx: AdminContext) => {
    const parsed = seedSchema.parse(input);
    return seedPairBankFromTopic(db(ctx), {
      topicId: parsed.topicId,
      bankName: parsed.bankName,
      includeArticles: parsed.includeArticles,
      includeParagraphs: parsed.includeParagraphs,
    });
  },
);

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
      // trackingDb makes each judge call write an llmCallTracking row (matches the CLI);
      // without it, even successful Judge Lab sweeps leave no per-call cost/audit trail.
      { dryRun: parsed.dryRun, userId: ctx.adminUserId, trackingDb: db(ctx) },
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
    const rows = data ?? [];

    // The leaderboard view exposes only prompt_variant_hash; enrich each row with the actual
    // custom-prompt text (judge_eval_runs.prompt_variant) so the UI can show whether a custom
    // prompt was used and what it was. Batch-fetch by eval_run_id (avoids N+1).
    const runIds = Array.from(
      new Set(rows.map((r) => r.eval_run_id).filter((id): id is string => !!id)),
    );
    const promptByRun = new Map<string, string | null>();
    if (runIds.length > 0) {
      const { data: runs, error: runsErr } = await db(ctx)
        .from('judge_eval_runs')
        .select('id, prompt_variant')
        .in('id', runIds);
      if (runsErr) throw runsErr;
      for (const run of runs ?? []) promptByRun.set(run.id, run.prompt_variant ?? null);
    }
    return rows.map((r) => {
      const promptVariant = r.eval_run_id ? promptByRun.get(r.eval_run_id) ?? null : null;
      return { ...r, prompt_variant: promptVariant, used_custom_prompt: !!promptVariant };
    });
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

    // Core columns only — this powers the per-kind aggregates + per-pair table, which never
    // render the heavy audit payload. The dedicated match-history view fetches that per-row.
    let q = db(ctx)
      .from('judge_eval_calls')
      .select(CORE_CALL_COLUMNS)
      .eq('eval_run_id', parsed.runId)
      .order('pair_label', { ascending: true })
      .order('repeat_index', { ascending: true });
    if (parsed.kind !== 'both') q = q.eq('pair_kind', parsed.kind);
    const callsRes = await q;
    if (callsRes.error) throw callsRes.error;

    // .select(<string>) loses supabase-js row inference → cast to the typed Core shape.
    return { run: runRes.data, calls: (callsRes.data ?? []) as unknown as JudgeEvalCallCore[] };
  },
);

const callsListSchema = z.object({
  runId: z.string().uuid(),
  kind: z.enum(['article', 'paragraph', 'both']).default('both'),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

/** Match-history LIST for one eval run: light Core rows (verdict + metrics + ground-truth snapshot),
 *  paginated, ordered by pair then repeat. Never selects the heavy audit payload — the row detail
 *  is fetched lazily via getJudgeEvalCallDetailAction. Returns the filtered total for pagination. */
export const getJudgeEvalCallsAction = adminAction(
  'getJudgeEvalCalls',
  async (input: z.input<typeof callsListSchema>, ctx: AdminContext) => {
    const parsed = callsListSchema.parse(input);
    let q = db(ctx)
      .from('judge_eval_calls')
      .select(CORE_CALL_COLUMNS, { count: 'exact' })
      .eq('eval_run_id', parsed.runId)
      .order('pair_label', { ascending: true })
      .order('repeat_index', { ascending: true })
      .range(parsed.offset, parsed.offset + parsed.limit - 1);
    if (parsed.kind !== 'both') q = q.eq('pair_kind', parsed.kind);
    const { data, error, count } = await q;
    if (error) throw error;
    return {
      calls: (data ?? []) as unknown as JudgeEvalCallCore[],
      total: count ?? 0,
      limit: parsed.limit,
      offset: parsed.offset,
    };
  },
);

const callDetailSchema = z.object({ callId: z.string().uuid() });

/** AUDIT payload for ONE expanded match: the exact rendered forward/reverse prompts, per-pass
 *  reasoning trace (+ format) and raw output. Legacy rows (pre-migration) return all-null audit
 *  fields — callers render the empty state rather than treating it as an error. */
export const getJudgeEvalCallDetailAction = adminAction(
  'getJudgeEvalCallDetail',
  async (input: z.input<typeof callDetailSchema>, ctx: AdminContext) => {
    const parsed = callDetailSchema.parse(input);
    const { data, error } = await db(ctx)
      .from('judge_eval_calls')
      .select(AUDIT_CALL_COLUMNS)
      .eq('id', parsed.callId)
      .single();
    if (error) throw error;
    return data as unknown as JudgeEvalCallAudit;
  },
);
