// Escalation sweep orchestrator: resolves a frozen test set, enforces the worst-case cost ceiling
// (chainCap), and runs the mode-aware escalation chain through the evaluator, persisting one
// judge_eval_calls row per submatch (grouped into matches by submatch_group_key). Mirrors
// executeSweep.ts for the single-judge path. The per-pair orchestration (runEscalationOverPairs)
// is pure over an injected makeJudge, so it is unit-testable with a fake (no LLM/DB).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { JudgeEvalPair, JudgeKindFilter, JudgeReasoningEffort } from './schemas';
import { loadTestSetPairs } from './persist';
import { createCallLLMJudge, type JudgeFn } from './runJudgeEval';
import { evaluatePairWithEscalation } from './escalation';
import {
  submatchToCallRow,
  submatchGroupKey,
  upsertEscalationRun,
  replaceEscalationCalls,
  dimensionVerdictRows,
  insertDimensionVerdicts,
  type EscalationCallRow,
  type DimensionVerdictRow,
} from './escalationPersist';
import { getAggregationRule } from '../shared/judgeEnsemble/aggregation';
import type { ResolvedJudgeRubric } from '../shared/rubricJudge';
import { estimateSweepCost } from './cost';
import { assertWithinJudgeEvalCap } from './settings';

type Db = SupabaseClient<Database>;

export interface EscalationChainSpec {
  name: string;
  article: string[];
  paragraph: string[];
  rule: string;
  ruleVersion: number;
  cap: number;
  /** 'escalation' (default) = sequential stop-on-decisive ladder. 'criteria_split' = one judge per
   *  rubric dimension, folded by criteria_weighted (requires a rubric). */
  planner?: 'escalation' | 'criteria_split';
  /** criteria_split only: criteria_id -> model (unmapped criteria round-robin over the chain models). */
  criteriaModelMap?: Record<string, string>;
}

export interface EscalationRows {
  callRows: EscalationCallRow[];
  /** Per-dimension verdict rows for rubric-mode submatches (empty for holistic). */
  dimensionRows: DimensionVerdictRow[];
}

/** Run the mode-aware escalation chain over every pair: one call row per submatch, plus per-dimension
 *  verdict rows when judging via a rubric. Pure over makeJudge. */
export async function runEscalationOverPairs(
  pairs: JudgeEvalPair[],
  chain: EscalationChainSpec,
  repeats: number,
  makeJudge: (model: string) => JudgeFn,
  settings?: { customPromptOverride?: string | null; explainReasoning?: boolean },
  rubric?: ResolvedJudgeRubric,
): Promise<EscalationRows> {
  const rule = getAggregationRule(chain.rule, chain.ruleVersion);
  const callRows: EscalationCallRow[] = [];
  const dimensionRows: DimensionVerdictRow[] = [];
  for (const pair of pairs) {
    const models = pair.pair_kind === 'article' ? chain.article : chain.paragraph;
    if (models.length === 0) continue;
    for (let rep = 0; rep < repeats; rep += 1) {
      const outcome = await evaluatePairWithEscalation(
        pair,
        {
          chainModels: models,
          rule,
          cap: chain.cap,
          settings,
          rubric,
          planner: chain.planner,
          criteriaModelMap: chain.criteriaModelMap,
        },
        makeJudge,
      );
      const groupKey = submatchGroupKey(pair.label, rep);
      const matchWinner = outcome.consolidated.winner;
      for (const sub of outcome.submatches) {
        const row = submatchToCallRow(pair, sub, groupKey, rep);
        callRows.push(row);
        if (sub.rubricBreakdown) {
          dimensionRows.push(...dimensionVerdictRows(row.id, sub.rubricBreakdown, matchWinner));
        }
      }
    }
  }
  return { callRows, dimensionRows };
}

export interface EscalationSweepInput {
  testSetId: string;
  kindFilter: JudgeKindFilter;
  chain: EscalationChainSpec;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  promptVariant: string | null;
  explainReasoning: boolean;
  repeats: number;
  /** When set, every submatch judges via this rubric (per-dimension verdicts persisted). */
  rubric?: ResolvedJudgeRubric;
}

export interface EscalationSweepOutcome {
  testSetId: string;
  pairCount: number;
  estimate: { cells: number; comparisons: number; estimatedCostUsd: number };
  plannedCalls: number;
  dryRun: boolean;
  runId: string | null;
  callCount: number;
}

export interface ExecuteEscalationSweepOptions {
  dryRun?: boolean;
  userId?: string;
  trackingDb?: Db;
}

async function insertChain(db: Db, chain: EscalationChainSpec): Promise<string> {
  const { data, error } = await db
    .from('judge_eval_chains')
    .insert({
      name: chain.name,
      article_models: chain.article as unknown as Database['public']['Tables']['judge_eval_chains']['Insert']['article_models'],
      paragraph_models: chain.paragraph as unknown as Database['public']['Tables']['judge_eval_chains']['Insert']['paragraph_models'],
      aggregation_rule: chain.rule,
      aggregation_rule_version: chain.ruleVersion,
      cap: chain.cap,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function executeEscalationSweep(
  db: Db,
  input: EscalationSweepInput,
  opts: ExecuteEscalationSweepOptions = {},
): Promise<EscalationSweepOutcome> {
  const { pairs } = await loadTestSetPairs(db, input.testSetId, input.kindFilter);

  // Worst-case cost estimate: every distinct chain model judges every pair (over-estimate -> safe gate).
  const distinctModels = [...new Set([...input.chain.article, ...input.chain.paragraph])];
  const estimate = estimateSweepCost({
    models: distinctModels,
    temperatures: [input.temperature],
    reasoningEfforts: [input.reasoningEffort],
    promptVariants: 1,
    pairs,
    repeats: input.repeats,
    explainReasoning: input.explainReasoning,
  });

  // criteria_split runs ONE judge per rubric dimension (no early stop), so its worst-case
  // judges-per-match is EXACTLY the dimension count — the escalation cap does not apply.
  if (input.chain.planner === 'criteria_split' && !input.rubric) {
    throw new Error('criteria_split planner requires a rubric');
  }
  const worstCaseJudgesPerMatch =
    input.chain.planner === 'criteria_split'
      ? (input.rubric?.dimensions.length ?? input.chain.cap)
      : input.chain.cap;

  // Hard ceiling on the WORST case (every match runs the full chain) BEFORE any LLM call.
  const cap = assertWithinJudgeEvalCap({
    cells: 1,
    matchingPairs: pairs.length,
    repeats: input.repeats,
    estimatedCostUsd: estimate.estimatedCostUsd,
    chainCap: worstCaseJudgesPerMatch,
  });

  const base: EscalationSweepOutcome = {
    testSetId: input.testSetId,
    pairCount: pairs.length,
    estimate,
    plannedCalls: cap.plannedCalls,
    dryRun: opts.dryRun ?? false,
    runId: null,
    callCount: 0,
  };
  if (opts.dryRun) return base;

  const chainId = await insertChain(db, input.chain);
  const { runId } = await upsertEscalationRun(db, {
    testSetId: input.testSetId,
    chainId,
    chainModels: { article: input.chain.article, paragraph: input.chain.paragraph },
    aggregationRule: input.chain.rule,
    aggregationRuleVersion: input.chain.ruleVersion,
    cap: input.chain.cap,
    temperature: input.temperature,
    reasoningEffort: input.reasoningEffort,
    kindFilter: input.kindFilter,
    promptVariant: input.promptVariant,
    repeats: input.repeats,
  });

  const makeJudge = (model: string): JudgeFn =>
    createCallLLMJudge({
      judgeModel: model,
      temperature: input.temperature,
      reasoningEffort: input.reasoningEffort ?? undefined,
      userId: opts.userId,
      trackingDb: opts.trackingDb,
    });

  const rows = await runEscalationOverPairs(
    pairs as JudgeEvalPair[],
    input.chain,
    input.repeats,
    makeJudge,
    { customPromptOverride: input.promptVariant, explainReasoning: input.explainReasoning },
    input.rubric,
  );
  await replaceEscalationCalls(db, runId, rows.callRows);
  await insertDimensionVerdicts(db, rows.dimensionRows);

  return { ...base, runId, callCount: rows.callRows.length };
}
