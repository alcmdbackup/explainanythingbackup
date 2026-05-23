// Pure dispatch-resolution helpers for DebateThenGenerateFromPreviousArticleAgent.
// Mirrors the editingDispatch.ts shape but with debate-specific concerns:
//   - top-2 selection from the pool (top-Elo with deterministic id-tiebreak per Decision §12).
//   - cascade resolver for debateJudgeReasoningEffort (iter → strategy → registry default,
//     with defensive guard rejecting reasoning effort on non-reasoning models).
//   - kill-switch resolver for EVOLUTION_DEBATE_ENABLED (default 'true' string-contract).
//
// bring_back_debate_agent_20260506 Phase 1.14 + Phase 2.5.

import type { Variant } from '../../types';
import type { Rating } from '../../shared/computeRatings';
import { getModelInfo, getModelDefaultReasoningEffort } from '@/config/modelRegistry';

export type DebateDispatchEffectiveCap = 'unbounded' | 'pool_too_small';

/** Resolved cascade output: 'none' / 'low' / 'medium' / 'high', or undefined when
 *  reasoning effort should not be passed to callLLM at all. */
export type ResolvedReasoningEffort = 'none' | 'low' | 'medium' | 'high' | undefined;

/** Per-iteration override shape consumed by the cascade resolver. */
export interface DebateIterationCfg {
  debateJudgeReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

/** Strategy-wide override shape consumed by the cascade resolver. */
export interface DebateStrategyCfg {
  judgeModel: string;
  debateJudgeReasoningEffort?: 'none' | 'low' | 'medium' | 'high';
}

/**
 * Cascade resolver for debate's judge reasoning effort.
 *   1. Use iterCfg.debateJudgeReasoningEffort if defined.
 *   2. Else use strategyCfg.debateJudgeReasoningEffort if defined.
 *   3. Else fall back to the registry's defaultReasoningEffort for judgeModel.
 *   4. Else return undefined (callLLM skips the reasoningEffort param entirely).
 *
 * Defensive guard (Phase 2.5): if the cascade-resolved effort is non-undefined
 * BUT getModelInfo(judgeModel)?.supportsReasoning !== true, log + drop. This
 * catches legacy data or direct-write paths that bypassed the Phase 1.14 Zod
 * cross-field refinement at insert time. Without the guard, callLLM would try
 * to send a reasoning_effort param to a non-reasoning model and 400.
 *
 * @param iterCfg Per-iteration config — wins if debateJudgeReasoningEffort is set.
 * @param strategyCfg Strategy-level config — used if iterCfg is unset.
 * @param logger Optional logger; receives a 'warn' when the defensive guard fires.
 * @param metrics Optional metrics handle; receives 'debate_reasoning_effort_dropped'
 *   when the defensive guard fires.
 */
export function resolveDebateJudgeReasoningEffort(
  iterCfg: DebateIterationCfg,
  strategyCfg: DebateStrategyCfg,
  logger?: { warn: (msg: string, ctx?: Record<string, unknown>) => void },
  metrics?: { increment: (name: string) => void },
): ResolvedReasoningEffort {
  // Step 1-3: cascade through iter → strategy → registry default.
  const fromIter = iterCfg.debateJudgeReasoningEffort;
  const fromStrategy = strategyCfg.debateJudgeReasoningEffort;
  const fromRegistry = getModelDefaultReasoningEffort(strategyCfg.judgeModel);

  const resolved = fromIter ?? fromStrategy ?? fromRegistry;

  // Step 4: undefined short-circuits cleanly — callLLM omits the reasoningEffort param.
  if (resolved === undefined) return undefined;

  // Defensive guard: post-cascade capability check.
  // The Zod refinement on strategyConfigBaseSchema would normally reject this at
  // insert time, but legacy data + direct-write paths could bypass it. Drop the
  // effort and log so the misconfiguration is observable.
  if (getModelInfo(strategyCfg.judgeModel)?.supportsReasoning !== true) {
    logger?.warn('Debate reasoning effort dropped — judgeModel does not support reasoning', {
      judgeModel: strategyCfg.judgeModel,
      requestedEffort: resolved,
      droppedReason: 'model_does_not_support_reasoning',
    });
    metrics?.increment('debate_reasoning_effort_dropped');
    return undefined;
  }

  return resolved;
}

/**
 * Top-2 selection from the iteration-start pool snapshot per Decision §16.
 * Excludes arena variants (they're rated by external comparisons, not eligible
 * as debate parents) and applies a deterministic id-tiebreak on Elo ties per
 * Decision §12.
 *
 * Returns null when the pool has fewer than 2 eligible non-arena rated variants —
 * the dispatch site should treat this as a Phase-2.1 'gate' failurePoint.
 */
export function resolveDebateDispatchRuntime(args: {
  pool: ReadonlyArray<Variant>;
  arenaVariantIds: ReadonlySet<string>;
  iterationStartRatings: ReadonlyMap<string, Rating>;
}): { variantA: Variant; variantB: Variant; effectiveCap: DebateDispatchEffectiveCap } | null {
  const { pool, arenaVariantIds, iterationStartRatings } = args;
  const filtered = pool.filter((v) => !arenaVariantIds.has(v.id) && iterationStartRatings.has(v.id));
  if (filtered.length < 2) return null;

  // Sort by Elo desc with deterministic id-tiebreak (lower id wins on tie per Decision §12).
  const sorted = [...filtered].sort((a, b) => {
    const ea = iterationStartRatings.get(a.id)?.elo ?? Number.NEGATIVE_INFINITY;
    const eb = iterationStartRatings.get(b.id)?.elo ?? Number.NEGATIVE_INFINITY;
    if (eb !== ea) return eb - ea;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { variantA: sorted[0]!, variantB: sorted[1]!, effectiveCap: 'unbounded' };
}

/**
 * Planner entry: returns whether debate WOULD dispatch given a projected pool size.
 * Used by projectDispatchPlan at strategy-creation/preview time.
 */
export function resolveDebateDispatchPlanner(args: {
  projectedPoolSize: number;
}): { willDispatch: boolean; effectiveCap: DebateDispatchEffectiveCap } {
  if (args.projectedPoolSize < 2) {
    return { willDispatch: false, effectiveCap: 'pool_too_small' };
  }
  return { willDispatch: true, effectiveCap: 'unbounded' };
}

/**
 * Kill-switch resolver for EVOLUTION_DEBATE_ENABLED.
 * String-contract per Decision §11: `process.env.X !== 'false'`. Default 'true'.
 * Anything other than the literal string 'false' (including unset, '', 'no', '0',
 * typos) leaves the feature enabled.
 */
export function resolveDebateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EVOLUTION_DEBATE_ENABLED !== 'false';
}
