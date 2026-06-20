// Agreement sweep orchestrator: resolve a frozen test set, enforce the hard cost ceiling (4 calls/
// pair·repeat = 2 holistic + 2 rubric, gated via chainCap=2), run the agreement engine, and persist
// the run + call rows + per-criterion verdicts. Mirrors executeEscalationSweep.ts. The per-pair work
// (runAgreementOverPairs) is pure over an injected JudgeFn — unit-testable with a fake (no LLM/DB).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { JudgeEvalPair, JudgeKindFilter, JudgeReasoningEffort } from './schemas';
import { loadTestSetPairs } from './persist';
import { createCallLLMJudge } from './runJudgeEval';
import { runAgreementOverPairs } from './agreement';
import { upsertAgreementRun, replaceAgreementCalls } from './agreementPersist';
import { estimateSweepCost } from './cost';
import { assertWithinJudgeEvalCap } from './settings';
import { readPartialResults } from './schemas';
import type { AgreementCallResult } from './agreement';
import type { ResolvedJudgeRubric } from '../shared/rubricJudge';

type Db = SupabaseClient<Database>;

export interface AgreementSweepInput {
  testSetId: string;
  kindFilter: JudgeKindFilter;
  judgeModel: string;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  /** Resolved rubric for the rubric judge (rubric.rubricId is persisted as judge_rubric_id). */
  rubric: ResolvedJudgeRubric;
  repeats: number;
}

export interface AgreementSweepOutcome {
  testSetId: string;
  pairCount: number;
  estimate: { cells: number; comparisons: number; estimatedCostUsd: number };
  plannedCalls: number;
  dryRun: boolean;
  runId: string | null;
  callCount: number;
  criterionCount: number;
}

export interface ExecuteAgreementSweepOptions {
  dryRun?: boolean;
  userId?: string;
  trackingDb?: Db;
}

export async function executeAgreementSweep(
  db: Db,
  input: AgreementSweepInput,
  opts: ExecuteAgreementSweepOptions = {},
): Promise<AgreementSweepOutcome> {
  const { pairs } = await loadTestSetPairs(db, input.testSetId, input.kindFilter);

  // estimateSweepCost returns the 2-pass (holistic-shaped) cost for the single model/temp/reasoning
  // cell. The agreement sweep runs BOTH a holistic 2-pass AND a rubric 2-pass per pair·repeat, so the
  // real cost is ~2× this estimate (the rubric prompt is a bit longer, but the estimate is coarse).
  const single = estimateSweepCost({
    models: [input.judgeModel],
    temperatures: [input.temperature],
    reasoningEfforts: [input.reasoningEffort],
    promptVariants: 1,
    pairs,
    repeats: input.repeats,
    explainReasoning: false,
  });
  const estimate = {
    cells: single.cells,
    comparisons: single.comparisons,
    estimatedCostUsd: single.estimatedCostUsd * 2,
  };

  // 4 LLM calls per pair·repeat = 2 holistic + 2 rubric. plannedCalls = cells*pairs*repeats*2*chainCap;
  // chainCap=2 (holistic + rubric = 2 judges per match) yields the ×4 factor. Gate BEFORE any LLM call.
  const cap = assertWithinJudgeEvalCap({
    cells: 1,
    matchingPairs: pairs.length,
    repeats: input.repeats,
    estimatedCostUsd: estimate.estimatedCostUsd,
    chainCap: 2,
  });

  const base: AgreementSweepOutcome = {
    testSetId: input.testSetId,
    pairCount: pairs.length,
    estimate,
    plannedCalls: cap.plannedCalls,
    dryRun: opts.dryRun ?? false,
    runId: null,
    callCount: 0,
    criterionCount: 0,
  };
  if (opts.dryRun) return base;

  const { runId } = await upsertAgreementRun(db, {
    testSetId: input.testSetId,
    judgeModel: input.judgeModel,
    temperature: input.temperature,
    reasoningEffort: input.reasoningEffort,
    judgeRubricId: input.rubric.rubricId,
    kindFilter: input.kindFilter,
    repeats: input.repeats,
  });

  const judge = createCallLLMJudge({
    judgeModel: input.judgeModel,
    temperature: input.temperature,
    reasoningEffort: input.reasoningEffort ?? undefined,
    userId: opts.userId,
    trackingDb: opts.trackingDb,
  });

  // On a mid-sweep LLM failure, persist everything completed so far (carried on the thrown error)
  // so a failed cell becomes a real errored run instead of a 0-call orphan, then re-throw. Mirrors
  // executeSweep.ts.
  let results: AgreementCallResult[];
  try {
    results = await runAgreementOverPairs(pairs as JudgeEvalPair[], input.rubric, input.repeats, judge);
  } catch (e) {
    const partial = readPartialResults(e) as unknown as AgreementCallResult[];
    if (partial.length > 0) await replaceAgreementCalls(db, runId, partial);
    throw e;
  }
  const { callCount, criterionCount } = await replaceAgreementCalls(db, runId, results);

  return { ...base, runId, callCount, criterionCount };
}
