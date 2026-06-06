// Sweep orchestrator: resolves a frozen test set, enforces the hard cost ceiling, runs the
// settings grid (models × temperatures × reasoning) through the engine, and persists results.
// Shared by the CLI (judge-eval.ts) and the server action (judgeEvalActions.ts) so both honor
// the same cap + idempotency. Returns a per-cell summary; --dry-run returns only the estimate.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { JudgeEvalPair, JudgeKindFilter, JudgeReasoningEffort } from './schemas';
import { loadTestSetPairs, upsertRun, replaceCalls } from './persist';
import { runJudgeEval, createCallLLMJudge } from './runJudgeEval';
import { estimateSweepCost } from './cost';
import { assertWithinJudgeEvalCap } from './settings';

type Db = SupabaseClient<Database>;

export interface SweepGrid {
  testSetId: string;
  kindFilter: JudgeKindFilter;
  models: string[];
  temperatures: number[];
  reasoningEfforts: Array<JudgeReasoningEffort | null>;
  promptVariant: string | null;
  explainReasoning: boolean;
  repeats: number;
}

export interface SweepCellResult {
  judgeModel: string;
  temperature: number;
  reasoningEffort: JudgeReasoningEffort | null;
  runId: string;
  settingsKey: string;
  calls: number;
}

export interface SweepOutcome {
  testSetId: string;
  pairCount: number;
  estimate: { cells: number; comparisons: number; estimatedCostUsd: number };
  plannedCalls: number;
  dryRun: boolean;
  cells: SweepCellResult[];
}

export interface ExecuteSweepOptions {
  dryRun?: boolean;
  concurrency?: number;
  userId?: string;
  /** Required for non-Next.js contexts (CLI) so the llmCallTracking write has a client. */
  trackingDb?: Db;
}

export async function executeSweep(
  db: Db,
  grid: SweepGrid,
  opts: ExecuteSweepOptions = {},
): Promise<SweepOutcome> {
  const { pairs } = await loadTestSetPairs(db, grid.testSetId, grid.kindFilter);

  const estimate = estimateSweepCost({
    models: grid.models,
    temperatures: grid.temperatures,
    reasoningEfforts: grid.reasoningEfforts,
    promptVariants: 1,
    pairs,
    repeats: grid.repeats,
    explainReasoning: grid.explainReasoning,
  });

  // Hard ceiling + kill switch BEFORE any LLM call (throws on violation).
  const cap = assertWithinJudgeEvalCap({
    cells: estimate.cells,
    matchingPairs: pairs.length,
    repeats: grid.repeats,
    estimatedCostUsd: estimate.estimatedCostUsd,
  });

  const base: SweepOutcome = {
    testSetId: grid.testSetId,
    pairCount: pairs.length,
    estimate,
    plannedCalls: cap.plannedCalls,
    dryRun: opts.dryRun ?? false,
    cells: [],
  };
  if (opts.dryRun) return base;

  const cells: SweepCellResult[] = [];
  for (const model of grid.models) {
    for (const temperature of grid.temperatures) {
      for (const reasoningEffort of grid.reasoningEfforts) {
        const { runId, settingsKey } = await upsertRun(db, {
          testSetId: grid.testSetId,
          judgeModel: model,
          temperature,
          reasoningEffort,
          kindFilter: grid.kindFilter,
          promptVariant: grid.promptVariant,
          repeats: grid.repeats,
        });

        const judge = createCallLLMJudge({
          judgeModel: model,
          temperature,
          reasoningEffort: reasoningEffort ?? undefined,
          userId: opts.userId,
          trackingDb: opts.trackingDb,
        });

        const results = await runJudgeEval(
          pairs as JudgeEvalPair[],
          {
            judgeModel: model,
            temperature,
            reasoningEffort: reasoningEffort ?? undefined,
            customPromptOverride: grid.promptVariant,
            explainReasoning: grid.explainReasoning,
          },
          grid.repeats,
          judge,
          opts.concurrency,
        );
        await replaceCalls(db, runId, results);

        cells.push({
          judgeModel: model,
          temperature,
          reasoningEffort,
          runId,
          settingsKey,
          calls: results.length * 2,
        });
      }
    }
  }
  return { ...base, cells };
}
