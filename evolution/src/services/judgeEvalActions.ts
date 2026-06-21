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
  loadTestSetPairs,
} from '@evolution/lib/judgeEval/persist';
import { executeSweep, type SweepOutcome } from '@evolution/lib/judgeEval/executeSweep';
import { estimateSweepCost } from '@evolution/lib/judgeEval/cost';
import {
  assertWithinJudgeEvalCap,
  plannedCalls,
  DEFAULT_JUDGE_EVAL_MAX_CALLS,
  DEFAULT_JUDGE_EVAL_MAX_USD,
} from '@evolution/lib/judgeEval/settings';
import { parseWinner } from '@evolution/lib/shared/computeRatings';
import { parseRubricVerdict } from '@evolution/lib/shared/rubricJudge';
import { wilsonScoreCI } from '@evolution/lib/shared/wilsonCI';
import type { PositionBiasAggregates } from '@evolution/lib/judgeEval/agreementMetrics';
import {
  executeEscalationSweep,
  type EscalationSweepOutcome,
} from '@evolution/lib/judgeEval/executeEscalationSweep';
import {
  executeAgreementSweep,
  type AgreementSweepOutcome,
} from '@evolution/lib/judgeEval/executeAgreementSweep';
import { seedPairBankFromTopic } from '@evolution/lib/judgeEval/seed';
import { getJudgeRubricForEvaluation } from './judgeRubricActions';
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

const createEscalationSweepSchema = z.object({
  testSetName: z.string().min(1),
  kindFilter: kindFilterSchema.default('both'),
  articleModels: z.array(z.string().min(1)).max(20).default([]),
  paragraphModels: z.array(z.string().min(1)).max(20).default([]),
  rule: z.string().min(1).default('first_decisive'),
  ruleVersion: z.number().int().min(1).default(1),
  cap: z.number().int().min(1).max(10).default(3),
  temperature: z.number().min(0).max(2).default(0),
  reasoningEffort: reasoningEffortSchema.nullable().default(null),
  promptVariant: z.string().max(4000).nullable().default(null),
  explainReasoning: z.boolean().default(false),
  repeats: z.number().int().min(1).max(50).default(10),
  /** Optional: judge each submatch via this rubric (per-dimension verdicts persisted). */
  judgeRubricId: z.string().uuid().nullable().default(null),
  /** Dispatch: 'escalation' (sequential ladder) or 'criteria_split' (one judge per rubric dimension). */
  planner: z.enum(['escalation', 'criteria_split']).default('escalation'),
  dryRun: z.boolean().default(false),
});

export const createEscalationSweepAction = adminAction(
  'createEscalationSweep',
  async (
    input: z.input<typeof createEscalationSweepSchema>,
    ctx: AdminContext,
  ): Promise<EscalationSweepOutcome> => {
    const parsed = createEscalationSweepSchema.parse(input);

    const allowed = new Set(getEvolutionModelIds());
    for (const m of [...parsed.articleModels, ...parsed.paragraphModels]) {
      if (!allowed.has(m)) throw new Error(`Invalid judgeModel: ${m}`);
    }
    if (parsed.articleModels.length === 0 && parsed.paragraphModels.length === 0) {
      throw new Error('At least one article or paragraph chain model is required');
    }

    const testSet = await loadTestSetByName(db(ctx), parsed.testSetName);
    if (!testSet) throw new Error(`Test set not found: ${parsed.testSetName}`);

    // Resolve the optional rubric: each submatch then judges per-dimension (verdicts persisted).
    const rubric = parsed.judgeRubricId
      ? (await getJudgeRubricForEvaluation(db(ctx), parsed.judgeRubricId)) ?? undefined
      : undefined;
    if (parsed.judgeRubricId && !rubric) {
      throw new Error(`Judge rubric not found or has no active criteria: ${parsed.judgeRubricId}`);
    }
    if (parsed.planner === 'criteria_split' && !rubric) {
      throw new Error('criteria_split planner requires a judge rubric (judgeRubricId)');
    }

    const customPrompt = parsed.promptVariant?.trim() || null;

    // criteria_split MUST fold per-criterion verdicts with criteria_weighted (the evaluator uses the
    // chain rule); force it so a stale escalation rule can't mis-aggregate a split.
    const rule = parsed.planner === 'criteria_split' ? 'criteria_weighted' : parsed.rule;
    const ruleVersion = parsed.planner === 'criteria_split' ? 1 : parsed.ruleVersion;

    // executeEscalationSweep enforces the worst-case (chainCap) cost ceiling before any LLM call.
    return executeEscalationSweep(
      db(ctx),
      {
        testSetId: testSet.id,
        kindFilter: parsed.kindFilter,
        chain: {
          name: `${rule}@${ruleVersion} cap${parsed.cap}`,
          article: parsed.articleModels,
          paragraph: parsed.paragraphModels,
          rule,
          ruleVersion,
          cap: parsed.cap,
          planner: parsed.planner,
        },
        temperature: parsed.temperature,
        reasoningEffort: parsed.reasoningEffort as JudgeReasoningEffort | null,
        promptVariant: customPrompt,
        explainReasoning: parsed.explainReasoning,
        repeats: parsed.repeats,
        rubric,
      },
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

const variantPairSchema = z.object({
  variantA: z.string().uuid(),
  variantB: z.string().uuid(),
});

/** Resolve a judge-eval call's snapshotted variant pair to a recorded arena comparison so the match
 *  can be opened in the Match Viewer. Judge-eval pairs are seeded FROM evolution_arena_comparisons
 *  (entry_a/entry_b), so a comparison almost always exists; we match either entry order and return
 *  the newest. Returns { comparisonId: null } when none is found (e.g. the comparison was deleted).
 *  variantA/variantB are validated UUIDs, so they are safe to interpolate into the PostgREST filter. */
export const findArenaComparisonForVariantsAction = adminAction(
  'findArenaComparisonForVariants',
  async (input: z.input<typeof variantPairSchema>, ctx: AdminContext) => {
    const { variantA, variantB } = variantPairSchema.parse(input);
    const { data, error } = await db(ctx)
      .from('evolution_arena_comparisons')
      .select('id')
      .or(`and(entry_a.eq.${variantA},entry_b.eq.${variantB}),and(entry_a.eq.${variantB},entry_b.eq.${variantA})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return { comparisonId: data?.id ?? null };
  },
);

// ─── Agreement sweep (holistic ↔ rubric) ────────────────────────────────────────────────────────
// Compare_critera_judge_vs_whole_article_paragraph_judge_evolution_20260619: runs a HOLISTIC
// (no-rubric) judge AND a RUBRIC judge on the same pairs and measures how often the rubric — overall
// and per criterion — agrees with the holistic winner (+ each side's accuracy vs the Elo ground truth).

// Core (no raw audit) columns for judge_eval_agreement_calls reads — never SELECT *.
const CORE_AGREEMENT_CALL_COLUMNS =
  'id, agreement_run_id, pair_label, pair_kind, repeat_index, holistic_winner, holistic_confidence, ' +
  'holistic_decisive, rubric_winner, rubric_confidence, rubric_decisive, rubric_matches_holistic, ' +
  'holistic_cost_usd, rubric_cost_usd, cost_usd, wall_ms, error, created_at, mu_a, mu_b, sigma_a, ' +
  'sigma_b, baseline_confidence, gap_kind, expected_winner, variant_a_id, variant_b_id';
// Raws only — fetched server-side in getAgreementRunDetailAction for position-bias derivation,
// and by getAgreementCallDetailAction for the /matches expanded detail view.
const AGREEMENT_AUDIT_COLUMNS =
  'id, holistic_forward_raw, holistic_reverse_raw, rubric_forward_raw, rubric_reverse_raw';
// Per-criterion verdict — extended with forward/reverse_verdict for the /matches detail expansion.
const AGREEMENT_CRITERION_COLUMNS =
  'id, agreement_call_id, criteria_id, criteria_name, weight, dimension_winner, ' +
  'forward_verdict, reverse_verdict, agrees_with_holistic, matches_ground_truth, position';

export type AgreementCallCore =
  Database['public']['Tables']['judge_eval_agreement_calls']['Row'];
export type AgreementCriterionRow =
  Database['public']['Tables']['judge_eval_agreement_criterion_verdicts']['Row'];

const createAgreementSweepSchema = z.object({
  testSetName: z.string().min(1),
  kindFilter: kindFilterSchema.default('both'),
  judgeModel: z.string().min(1),
  temperature: z.number().min(0).max(2).default(0),
  reasoningEffort: reasoningEffortSchema.nullable().default(null),
  judgeRubricId: z.string().uuid(),
  repeats: z.number().int().min(1).max(50).default(10),
  dryRun: z.boolean().default(false),
});

export const createAgreementSweepAction = adminAction(
  'createAgreementSweep',
  async (
    input: z.input<typeof createAgreementSweepSchema>,
    ctx: AdminContext,
  ): Promise<AgreementSweepOutcome> => {
    const parsed = createAgreementSweepSchema.parse(input);

    const allowed = new Set(getEvolutionModelIds());
    if (!allowed.has(parsed.judgeModel)) throw new Error(`Invalid judgeModel: ${parsed.judgeModel}`);

    const testSet = await loadTestSetByName(db(ctx), parsed.testSetName);
    if (!testSet) throw new Error(`Test set not found: ${parsed.testSetName}`);

    // A rubric is REQUIRED for an agreement sweep — hard-fail rather than silently falling back to a
    // holistic-only run (which would make the comparison meaningless).
    const rubric = await getJudgeRubricForEvaluation(db(ctx), parsed.judgeRubricId);
    if (!rubric) {
      throw new Error(`Judge rubric not found or has no active criteria: ${parsed.judgeRubricId}`);
    }

    // executeAgreementSweep enforces the hard cost ceiling (4 calls/pair·repeat) + JUDGE_EVAL_ENABLED
    // before any LLM call. trackingDb writes an llmCallTracking row per judge call.
    return executeAgreementSweep(
      db(ctx),
      {
        testSetId: testSet.id,
        kindFilter: parsed.kindFilter,
        judgeModel: parsed.judgeModel,
        temperature: parsed.temperature,
        reasoningEffort: parsed.reasoningEffort as JudgeReasoningEffort | null,
        rubric,
        repeats: parsed.repeats,
      },
      { dryRun: parsed.dryRun, userId: ctx.adminUserId, trackingDb: db(ctx) },
    );
  },
);

const agreementLeaderboardSchema = z.object({
  testSetId: z.string().uuid(),
  kind: z.enum(['article', 'paragraph', 'both']).default('both'),
});

/** Wilson-augmented leaderboard row: SQL view row + per-rate CI bounds + worst-criterion column. */
export interface AgreementLeaderboardRow {
  // SQL view fields (existing).
  agreement_run_id: string | null;
  judge_model: string | null;
  judge_rubric_id: string | null;
  pair_kind: string | null;
  n_calls: number | null;
  strict_agree_rate: number | null;
  both_decisive_agree_rate: number | null;
  abstain_divergence_rate: number | null;
  holistic_accuracy: number | null;
  rubric_accuracy: number | null;
  total_cost_usd: number | null;
  // Wilson CI bounds — computed in TS from per-rate denominators (see strategy below).
  strict_agree_ci_low: number | null;
  strict_agree_ci_high: number | null;
  both_decisive_agree_ci_low: number | null;
  both_decisive_agree_ci_high: number | null;
  abstain_divergence_ci_low: number | null;
  abstain_divergence_ci_high: number | null;
  // Worst-disagreeing criterion for this (run × pair_kind).
  worst_criterion_name: string | null;
  worst_criterion_disagree_rate: number | null;
  worst_criterion_disagree_ci_low: number | null;
  worst_criterion_disagree_ci_high: number | null;
}

/** Headline agreement aggregates per run × pair_kind (SQL view) + Wilson CIs + worst-criterion.
 *  Zero LLM cost. **Implementation strategy: in-memory aggregation in TypeScript** — PostgREST cannot
 *  express COUNT(*) FILTER (...) directly via the JS client; adding an RPC would require a migration.
 *  In-memory aggregation reuses the same boolean predicates the reducer uses (single source of truth)
 *  and bounds row scan: ≤50 runs × ~1-4K calls/run on dense leaderboards. */
export const getAgreementLeaderboardAction = adminAction(
  'getAgreementLeaderboard',
  async (input: z.input<typeof agreementLeaderboardSchema>, ctx: AdminContext): Promise<AgreementLeaderboardRow[]> => {
    const parsed = agreementLeaderboardSchema.parse(input);
    const supabase = db(ctx);

    let q = supabase
      .from('judge_eval_agreement_leaderboard')
      .select('*')
      .eq('test_set_id', parsed.testSetId)
      .order('strict_agree_rate', { ascending: false, nullsFirst: false });
    if (parsed.kind !== 'both') q = q.eq('pair_kind', parsed.kind);
    const { data: viewRows, error: viewErr } = await q;
    if (viewErr) throw viewErr;
    const rows = (viewRows ?? []) as Array<Record<string, unknown>>;

    if (rows.length === 0) return [];

    // Collect unique run ids — bounded by leaderboard pagination (typically ≤ 50).
    const runIds = Array.from(
      new Set(rows.map((r) => r.agreement_run_id as string | null).filter((id): id is string => !!id)),
    );

    // Per-rate denominators: in-memory tally of calls. Light projection — only the columns the
    // boolean predicates need. Same predicates as agreementMetrics.ts (single source of truth).
    type DenomKey = string; // `${runId}|${pairKind}`
    type Denoms = {
      n_calls: number;
      strict_agree_n: number;
      both_decisive_n: number;
      both_decisive_agree_n: number;
      exactly_one_decisive_n: number;
    };
    const denoms = new Map<DenomKey, Denoms>();

    if (runIds.length > 0) {
      // IN-clause batching at 50-id chunks (defensive — leaderboard already paginates at 50).
      const CHUNK = 50;
      for (let i = 0; i < runIds.length; i += CHUNK) {
        const chunk = runIds.slice(i, i + CHUNK);
        const { data: callRows, error: cErr } = await supabase
          .from('judge_eval_agreement_calls')
          .select('agreement_run_id, pair_kind, holistic_winner, holistic_confidence, rubric_winner, rubric_confidence')
          .in('agreement_run_id', chunk)
          .is('error', null);
        if (cErr) throw cErr;
        for (const c of callRows ?? []) {
          const key = `${c.agreement_run_id}|${c.pair_kind}`;
          const d =
            denoms.get(key) ??
            {
              n_calls: 0,
              strict_agree_n: 0,
              both_decisive_n: 0,
              both_decisive_agree_n: 0,
              exactly_one_decisive_n: 0,
            };
          d.n_calls += 1;
          if (c.holistic_winner === c.rubric_winner) d.strict_agree_n += 1;
          const hd = (c.holistic_confidence ?? 0) > 0.6;
          const rd = (c.rubric_confidence ?? 0) > 0.6;
          if (hd && rd) {
            d.both_decisive_n += 1;
            if (c.holistic_winner === c.rubric_winner) d.both_decisive_agree_n += 1;
          }
          if (hd !== rd) d.exactly_one_decisive_n += 1;
          denoms.set(key, d);
        }
      }
    }

    // Worst-criterion-per-(run × pair_kind) — same in-memory strategy, joined via call FK.
    // Fetch criterion verdicts for all of this leaderboard's runs in batches; tally by
    // (run, pair_kind, criteria_name) → { decided, disagree }; pick max disagree-rate per (run, kind).
    type CritKey = string; // `${runId}|${pairKind}|${criteriaName}`
    const critTally = new Map<CritKey, { decided: number; disagree: number }>();
    if (runIds.length > 0) {
      const CHUNK = 50;
      for (let i = 0; i < runIds.length; i += CHUNK) {
        const chunk = runIds.slice(i, i + CHUNK);
        // We need pair_kind which lives on the calls table — embed via PostgREST nested select.
        const { data: critRows, error: critErr } = await supabase
          .from('judge_eval_agreement_criterion_verdicts')
          .select('criteria_name, agrees_with_holistic, judge_eval_agreement_calls!inner(agreement_run_id, pair_kind, error)')
          .in('judge_eval_agreement_calls.agreement_run_id', chunk)
          .is('judge_eval_agreement_calls.error', null);
        if (critErr) throw critErr;
        for (const r of critRows ?? []) {
          // PostgREST nested-select returns either an object or an array depending on FK direction;
          // judge_eval_agreement_calls is a single parent row here.
          const call = (r as Record<string, unknown>).judge_eval_agreement_calls as
            | { agreement_run_id: string; pair_kind: string }
            | { agreement_run_id: string; pair_kind: string }[]
            | null;
          if (!call) continue;
          const c = Array.isArray(call) ? call[0] : call;
          if (!c) continue;
          const key = `${c.agreement_run_id}|${c.pair_kind}|${(r as { criteria_name: string }).criteria_name}`;
          const t = critTally.get(key) ?? { decided: 0, disagree: 0 };
          const agrees = (r as { agrees_with_holistic: boolean | null }).agrees_with_holistic;
          if (agrees !== null) {
            t.decided += 1;
            if (agrees === false) t.disagree += 1;
          }
          critTally.set(key, t);
        }
      }
    }

    // For each leaderboard row, look up its denominators + worst criterion, compute Wilson CIs.
    const out: AgreementLeaderboardRow[] = rows.map((r) => {
      const runId = r.agreement_run_id as string | null;
      const pairKind = r.pair_kind as string | null;
      const denomKey = runId && pairKind ? `${runId}|${pairKind}` : null;
      const d = denomKey ? denoms.get(denomKey) ?? null : null;

      const strictCI = d ? wilsonScoreCI(d.strict_agree_n, d.n_calls) : null;
      const bothDecCI = d ? wilsonScoreCI(d.both_decisive_agree_n, d.both_decisive_n) : null;
      const abstainCI = d ? wilsonScoreCI(d.exactly_one_decisive_n, d.n_calls) : null;

      // Worst criterion: scan critTally entries matching (runId, pairKind), pick max disagree rate.
      let worstName: string | null = null;
      let worstRate: number | null = null;
      let worstDecided = 0;
      let worstDisagree = 0;
      if (runId && pairKind) {
        const prefix = `${runId}|${pairKind}|`;
        for (const [k, t] of critTally) {
          if (!k.startsWith(prefix)) continue;
          if (t.decided === 0) continue;
          const rate = t.disagree / t.decided;
          if (worstRate === null || rate > worstRate) {
            worstName = k.slice(prefix.length);
            worstRate = rate;
            worstDecided = t.decided;
            worstDisagree = t.disagree;
          }
        }
      }
      const worstCi = worstDecided > 0 ? wilsonScoreCI(worstDisagree, worstDecided) : null;

      return {
        agreement_run_id: runId,
        judge_model: (r.judge_model as string | null) ?? null,
        judge_rubric_id: (r.judge_rubric_id as string | null) ?? null,
        pair_kind: pairKind,
        n_calls: (r.n_calls as number | null) ?? null,
        strict_agree_rate: (r.strict_agree_rate as number | null) ?? null,
        both_decisive_agree_rate: (r.both_decisive_agree_rate as number | null) ?? null,
        abstain_divergence_rate: (r.abstain_divergence_rate as number | null) ?? null,
        holistic_accuracy: (r.holistic_accuracy as number | null) ?? null,
        rubric_accuracy: (r.rubric_accuracy as number | null) ?? null,
        total_cost_usd: (r.total_cost_usd as number | null) ?? null,
        strict_agree_ci_low: strictCI?.low ?? null,
        strict_agree_ci_high: strictCI?.high ?? null,
        both_decisive_agree_ci_low: bothDecCI?.low ?? null,
        both_decisive_agree_ci_high: bothDecCI?.high ?? null,
        abstain_divergence_ci_low: abstainCI?.low ?? null,
        abstain_divergence_ci_high: abstainCI?.high ?? null,
        worst_criterion_name: worstName,
        worst_criterion_disagree_rate: worstRate,
        worst_criterion_disagree_ci_low: worstCi?.low ?? null,
        worst_criterion_disagree_ci_high: worstCi?.high ?? null,
      };
    });
    return out;
  },
);

const agreementRunDetailSchema = z.object({ runId: z.string().uuid() });

/** Position-bias aggregates keyed by pair_kind. Computed server-side by parsing the stored raws
 *  (parseWinner on holistic raws, parseRubricVerdict on rubric raws). The page slices by kind and
 *  passes the matching aggregate to the reducer. */
export interface AgreementPositionBiasByKind {
  article: PositionBiasAggregates;
  paragraph: PositionBiasAggregates;
  both: PositionBiasAggregates;
}

const emptyBias = (): PositionBiasAggregates => ({
  holisticMismatch: 0,
  holisticParsed: 0,
  rubricMismatch: 0,
  rubricParsed: 0,
});

/** One agreement run's full data: the run row, all per-(pair × repeat) Core call rows (both kinds),
 *  all per-criterion verdict rows for those calls, AND position-bias aggregates parsed server-side
 *  from the stored raws. The page slices by kind + runs the pure computeAgreementMetrics reducer
 *  (matching the runs/[evalRunId] TS-reducer pattern). */
export const getAgreementRunDetailAction = adminAction(
  'getAgreementRunDetail',
  async (input: z.input<typeof agreementRunDetailSchema>, ctx: AdminContext) => {
    const { runId } = agreementRunDetailSchema.parse(input);
    const supabase = db(ctx);

    const runRes = await supabase
      .from('judge_eval_agreement_runs')
      .select('*')
      .eq('id', runId)
      .single();
    if (runRes.error) throw runRes.error;

    const callsRes = await supabase
      .from('judge_eval_agreement_calls')
      .select(CORE_AGREEMENT_CALL_COLUMNS)
      .eq('agreement_run_id', runId)
      .order('pair_label', { ascending: true })
      .order('repeat_index', { ascending: true });
    if (callsRes.error) throw callsRes.error;
    const calls = (callsRes.data ?? []) as unknown as AgreementCallCore[];

    // Criterion verdicts for this run's calls (the FK is to the calls table, not the run).
    const callIds = calls.map((c) => c.id);
    let criterionVerdicts: AgreementCriterionRow[] = [];
    if (callIds.length > 0) {
      const cvRes = await supabase
        .from('judge_eval_agreement_criterion_verdicts')
        .select(AGREEMENT_CRITERION_COLUMNS)
        .in('agreement_call_id', callIds);
      if (cvRes.error) throw cvRes.error;
      criterionVerdicts = (cvRes.data ?? []) as unknown as AgreementCriterionRow[];
    }

    // Position-bias derivation: fetch raws (light projection), parse each pass, tally per kind.
    // Null policy: both passes parse to a winner → counted; one or both null → excluded from `parsed`.
    const positionBias: AgreementPositionBiasByKind = {
      article: emptyBias(),
      paragraph: emptyBias(),
      both: emptyBias(),
    };

    if (callIds.length > 0) {
      // Need dimension names for parseRubricVerdict. Use the existing rubric resolver helper which
      // handles the embed + weight normalization + soft-delete filter in one place.
      const judgeRubricId = (runRes.data as { judge_rubric_id: string | null }).judge_rubric_id;
      let dimNames: string[] = [];
      if (judgeRubricId) {
        const rubric = await getJudgeRubricForEvaluation(supabase, judgeRubricId);
        if (rubric) dimNames = rubric.dimensions.map((d) => d.name);
      }

      const rawsRes = await supabase
        .from('judge_eval_agreement_calls')
        .select('pair_kind, holistic_forward_raw, holistic_reverse_raw, rubric_forward_raw, rubric_reverse_raw')
        .eq('agreement_run_id', runId)
        .is('error', null);
      if (!rawsRes.error && rawsRes.data) {
        type RawRow = {
          pair_kind: 'article' | 'paragraph';
          holistic_forward_raw: string | null;
          holistic_reverse_raw: string | null;
          rubric_forward_raw: string | null;
          rubric_reverse_raw: string | null;
        };
        // parseRubricVerdict returns Record<string, Verdict | null>; reduce to a winner via simple
        // majority (treats null/unparsable as "no signal" for position-bias purposes).
        const winnerOf = (rec: Record<string, string | null> | null): string | null => {
          if (!rec) return null;
          let a = 0, b = 0;
          for (const v of Object.values(rec)) {
            if (v === 'A') a += 1;
            else if (v === 'B') b += 1;
          }
          if (a === 0 && b === 0) return null;
          if (a > b) return 'A';
          if (b > a) return 'B';
          return 'TIE';
        };
        for (const r of rawsRes.data as unknown as RawRow[]) {
          const kindBucket = positionBias[r.pair_kind];

          // Holistic: parseWinner on each raw; only count when both parse.
          const hFwd = r.holistic_forward_raw ? parseWinner(r.holistic_forward_raw) : null;
          const hRev = r.holistic_reverse_raw ? parseWinner(r.holistic_reverse_raw) : null;
          if (hFwd !== null && hRev !== null) {
            kindBucket.holisticParsed += 1;
            positionBias.both.holisticParsed += 1;
            if (hFwd !== hRev) {
              kindBucket.holisticMismatch += 1;
              positionBias.both.holisticMismatch += 1;
            }
          }

          // Rubric: parseRubricVerdict needs dimension names. For position-bias we treat
          // null/unparsable as "no signal" and exclude from the denominator.
          if (dimNames.length > 0) {
            const rFwdVerdicts = r.rubric_forward_raw
              ? parseRubricVerdict(r.rubric_forward_raw, dimNames)
              : null;
            const rRevVerdicts = r.rubric_reverse_raw
              ? parseRubricVerdict(r.rubric_reverse_raw, dimNames)
              : null;
            const rFwd = winnerOf(rFwdVerdicts);
            const rRev = winnerOf(rRevVerdicts);
            if (rFwd !== null && rRev !== null) {
              kindBucket.rubricParsed += 1;
              positionBias.both.rubricParsed += 1;
              if (rFwd !== rRev) {
                kindBucket.rubricMismatch += 1;
                positionBias.both.rubricMismatch += 1;
              }
            }
          }
        }
      }
    }

    return { run: runRes.data, calls, criterionVerdicts, positionBias };
  },
);

// ─── Paginated /matches sub-route actions ────────────────────────────────────────────────────────

const agreementCallsListSchema = z.object({
  runId: z.string().uuid(),
  kind: z.enum(['article', 'paragraph', 'both']).default('both'),
  disagreeOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
});

/** Paginated Core rows for the agreement /matches sub-route. No raws — fetched lazily per row
 *  expand via getAgreementCallDetailAction. Returns the filtered total for pagination. */
export const getAgreementCallsAction = adminAction(
  'getAgreementCalls',
  async (input: z.input<typeof agreementCallsListSchema>, ctx: AdminContext) => {
    const parsed = agreementCallsListSchema.parse(input);
    let q = db(ctx)
      .from('judge_eval_agreement_calls')
      .select(CORE_AGREEMENT_CALL_COLUMNS, { count: 'exact' })
      .eq('agreement_run_id', parsed.runId)
      .order('pair_label', { ascending: true })
      .order('repeat_index', { ascending: true })
      .range(parsed.offset, parsed.offset + parsed.limit - 1);
    if (parsed.kind !== 'both') q = q.eq('pair_kind', parsed.kind);
    if (parsed.disagreeOnly) {
      // Both-decisive opposite-winner: conf > 0.6 on both AND holistic_winner !== rubric_winner.
      // PostgREST `.neq` on column-comparison isn't available, so do it client-side using
      // generated columns (holistic_decisive / rubric_decisive) + explicit winner mismatch filter.
      q = q.eq('holistic_decisive', true).eq('rubric_decisive', true);
    }
    const { data, error, count } = await q;
    if (error) throw error;
    let calls = (data ?? []) as unknown as AgreementCallCore[];
    if (parsed.disagreeOnly) {
      calls = calls.filter((c) => c.holistic_winner !== c.rubric_winner);
    }
    return {
      calls,
      total: count ?? 0,
      limit: parsed.limit,
      offset: parsed.offset,
    };
  },
);

const agreementCallDetailSchema = z.object({ callId: z.string().uuid() });

/** AUDIT payload for ONE expanded agreement match: the four raws (holistic forward/reverse +
 *  rubric forward/reverse) + the per-criterion verdicts for that call. Mirrors
 *  getJudgeEvalCallDetailAction. Legacy rows (pre-raws) return nulls — caller renders empty state. */
export const getAgreementCallDetailAction = adminAction(
  'getAgreementCallDetail',
  async (input: z.input<typeof agreementCallDetailSchema>, ctx: AdminContext) => {
    const parsed = agreementCallDetailSchema.parse(input);
    const supabase = db(ctx);

    const auditRes = await supabase
      .from('judge_eval_agreement_calls')
      .select(AGREEMENT_AUDIT_COLUMNS)
      .eq('id', parsed.callId)
      .single();
    if (auditRes.error) throw auditRes.error;

    const cvRes = await supabase
      .from('judge_eval_agreement_criterion_verdicts')
      .select(AGREEMENT_CRITERION_COLUMNS)
      .eq('agreement_call_id', parsed.callId)
      .order('position', { ascending: true });
    if (cvRes.error) throw cvRes.error;

    return {
      audit: auditRes.data,
      criterionVerdicts: (cvRes.data ?? []) as unknown as AgreementCriterionRow[],
    };
  },
);

// ─── Live cost-preview action (ZERO-LLM-CALL invariant) ──────────────────────────────────────────
//
// estimateAgreementCostAction is a ZERO-LLM-CALL action. It must perform only:
//   1. loadTestSetByName + loadTestSetPairs (DB reads)
//   2. test-set member filter by kindFilter (in-memory)
//   3. estimateSweepCost (pure math)
//   4. Cap-status check (pure math)
// It MUST NOT invoke createCallLLMJudge, runJudgeEval, executeAgreementSweep, or any LLM dispatcher.
// The live-preview loop calls this on every input change — a single inadvertent LLM call here would
// burn the global evolution cap on each keystroke.

const estimateAgreementCostSchema = z.object({
  testSetName: z.string().min(1),
  kindFilter: kindFilterSchema.default('both'),
  judgeModel: z.string().min(1),
  repeats: z.number().int().min(1).max(50),
  reasoningEffort: reasoningEffortSchema.nullable().default(null),
});

export interface AgreementCostEstimate {
  pairCount: number;
  /** Echoed back so the launcher can render an internally-consistent preview line (the
   *  client's React state for `repeats` updates immediately on keystroke but the action
   *  result is debounced — without echoing repeats back, the preview shows a transient
   *  N pairs × M repeats × 4 ≠ plannedCalls inconsistency until the new result lands). */
  repeats: number;
  plannedCalls: number;
  estimatedCostUsd: number;
  capStatus: 'ok' | 'over_calls' | 'over_usd';
  maxCalls: number;
  maxUsd: number;
}

export const estimateAgreementCostAction = adminAction(
  'estimateAgreementCost',
  async (input: z.input<typeof estimateAgreementCostSchema>, ctx: AdminContext): Promise<AgreementCostEstimate> => {
    const parsed = estimateAgreementCostSchema.parse(input);
    const supabase = db(ctx);

    const testSet = await loadTestSetByName(supabase, parsed.testSetName);
    if (!testSet) throw new Error(`Test set not found: ${parsed.testSetName}`);
    const { pairs } = await loadTestSetPairs(supabase, testSet.id, parsed.kindFilter);

    // estimateSweepCost returns the cost for ONE 2-pass comparison (forward + reverse) per pair×repeat.
    // Agreement runs TWO 2-pass comparisons per repeat (holistic + rubric), so we multiply by 2.
    const sweepEstimate = estimateSweepCost({
      models: [parsed.judgeModel],
      temperatures: [0],
      reasoningEfforts: [parsed.reasoningEffort],
      promptVariants: 1,
      pairs,
      repeats: parsed.repeats,
      explainReasoning: parsed.reasoningEffort !== null,
    });
    const estimatedCostUsd = sweepEstimate.estimatedCostUsd * 2;
    const callsPlanned = pairs.length * parsed.repeats * 4; // 4 calls per repeat (2 holistic + 2 rubric)

    // Cap check — non-throwing (return capStatus). Defaults match settings.ts.
    const maxCalls = Number(process.env.JUDGE_EVAL_MAX_CALLS) || DEFAULT_JUDGE_EVAL_MAX_CALLS;
    const maxUsd = Number(process.env.JUDGE_EVAL_MAX_USD) || DEFAULT_JUDGE_EVAL_MAX_USD;
    let capStatus: 'ok' | 'over_calls' | 'over_usd' = 'ok';
    if (callsPlanned > maxCalls) capStatus = 'over_calls';
    else if (estimatedCostUsd > maxUsd) capStatus = 'over_usd';

    return {
      pairCount: pairs.length,
      repeats: parsed.repeats,
      plannedCalls: callsPlanned,
      estimatedCostUsd,
      capStatus,
      maxCalls,
      maxUsd,
    };
  },
);
