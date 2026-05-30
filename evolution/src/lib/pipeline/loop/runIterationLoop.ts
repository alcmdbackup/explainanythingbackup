// Orchestrator-driven evolution loop with config-driven iteration dispatch.
// Iterates over config.iterationConfigs[], dispatching generate or swiss agents per iteration.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Variant } from '../../types';
import { BudgetExceededError } from '../../types';
import type { IterationAgentType } from '../../schemas';
import type { Rating, ComparisonResult } from '../../shared/computeRatings';
import { createRating, isConverged, DEFAULT_CONVERGENCE_UNCERTAINTY } from '../../shared/computeRatings';
import type { EvolutionConfig, EvolutionResult, V2Match, IterationResult, IterationStopReason } from '../infra/types';

import { createCostTracker, createIterationBudgetTracker, IterationBudgetExceededError, type V2CostTracker } from '../infra/trackBudget';

import type { EntityLogger } from '../infra/createEntityLogger';
import { selectWinner } from '../../shared/selectWinner';
import { GenerateFromPreviousArticleAgent } from '../../core/agents/generateFromPreviousArticle';
import {
  ReflectAndGenerateFromPreviousArticleAgent,
  type TacticCandidate,
} from '../../core/agents/reflectAndGenerateFromPreviousArticle';
import { EvaluateCriteriaThenGenerateFromPreviousArticleAgent } from '../../core/agents/evaluateCriteriaThenGenerateFromPreviousArticle';
import { SinglePassEvaluateCriteriaAndGenerateAgent } from '../../core/agents/singlePassEvaluateCriteriaAndGenerate';
import { ProposerApproverCriteriaGenerateAgent } from '../../core/agents/proposerApproverCriteriaGenerate';
import { ParagraphRecombineAgent } from '../../core/agents/paragraphRecombine/ParagraphRecombineAgent';
import { getCriteriaForEvaluation, type EvolutionCriterionRow } from '../../../services/criteriaActions';
import { SwissRankingAgent, type SwissRankingMatchEntry } from '../../core/agents/SwissRankingAgent';
import { MergeRatingsAgent, type MergeMatchEntry } from '../../core/agents/MergeRatingsAgent';
import { swissPairing, pairKey, MAX_PAIRS_PER_ROUND } from './swissPairing';
import { computeTop15Cutoff } from './rankSingleVariant';
import { resolveParent, hashSeed } from './resolveParent';
import { DEFAULT_TACTICS, type IterationSnapshot } from '../../schemas';
import { deriveSeed, SeededRandom } from '../../shared/seededRandom';
import { selectTacticWeighted, ALL_SYSTEM_TACTICS, ALL_TACTIC_NAMES, getTacticSummary } from '../../core/tactics';
import { getTacticEloBoostsForReflection } from '../../../services/tacticReflectionActions';
import { createSeededRng } from '../../metrics/experimentMetrics';
import type { AgentContext } from '../../core/types';
import { estimateAgentCost, estimateParagraphRecombineCost } from '../infra/estimateCosts';
import { DISPATCH_SAFETY_CAP } from './projectDispatchPlan';
import { resolveReflectionEnabled } from './reflectionDispatch';
import { resolveSequentialFloor } from './budgetFloorResolvers';

// ─── Config validation ───────────────────────────────────────────

function validateConfig(config: EvolutionConfig): void {
  if (!config.iterationConfigs || config.iterationConfigs.length === 0) {
    throw new Error('iterationConfigs must be a non-empty array');
  }
  if (config.iterationConfigs.length > MAX_ORCHESTRATOR_ITERATIONS) {
    throw new Error(`Too many iterations: ${config.iterationConfigs.length} (max ${MAX_ORCHESTRATOR_ITERATIONS})`);
  }
  if (config.budgetUsd <= 0 || config.budgetUsd > 50) {
    throw new Error(`Invalid budgetUsd: ${config.budgetUsd} (must be >0 and <=50)`);
  }
  if (!config.judgeModel || config.judgeModel.trim() === '') {
    throw new Error('judgeModel must be a non-empty string');
  }
  if (!config.generationModel || config.generationModel.trim() === '') {
    throw new Error('generationModel must be a non-empty string');
  }
}

// ─── Kill detection ──────────────────────────────────────────────

async function isRunKilled(db: SupabaseClient, runId: string, logger?: EntityLogger): Promise<boolean> {
  try {
    const { data, error } = await db.from('evolution_runs').select('status').eq('id', runId).single();
    if (error) {
      logger?.warn('Kill detection DB error (continuing)', { phaseName: 'kill_check' });
      return false;
    }
    return data?.status === 'failed' || data?.status === 'cancelled';
  } catch {
    logger?.warn('Kill detection exception (continuing)', { phaseName: 'kill_check' });
    return false;
  }
}

// ─── Safety cap ──────────────────────────────────────────────────

/** Hard cap on orchestrator iterations to prevent runaway loops. */
const MAX_ORCHESTRATOR_ITERATIONS = 20;

function topKEloValues(ratings: ReadonlyMap<string, Rating>, k: number): number[] {
  return [...ratings.values()].map((r) => r.elo).sort((a, b) => b - a).slice(0, k);
}

/** Phase 4b: parallel array — uncertainty for the same top-K ranking by elo. Returned in
 *  matching index order so EloTab can render an uncertainty band around each line.
 *  B005-S1: now wired into the loop; pushed to uncertaintyHistory after each iteration
 *  (lockstep with eloHistory). */
function topKUncertainties(ratings: ReadonlyMap<string, Rating>, k: number): number[] {
  return [...ratings.values()].sort((a, b) => b.elo - a.elo).slice(0, k).map((r) => r.uncertainty);
}

// ─── Snapshot helpers ────────────────────────────────────────────

function recordSnapshot(
  iteration: number,
  iterationType: IterationAgentType,
  phase: 'start' | 'end',
  pool: ReadonlyArray<Variant>,
  ratings: ReadonlyMap<string, Rating>,
  matchCounts: ReadonlyMap<string, number>,
  options?: {
    discardedVariantIds?: string[];
    discardReasons?: Record<string, { elo: number; top15Cutoff: number }>;
    stopReason?: string;
    budgetAllocated?: number;
    budgetSpent?: number;
  },
): IterationSnapshot {
  const ratingsObj = Object.fromEntries(
    [...ratings.entries()].map(([id, r]) => [id, { elo: r.elo, uncertainty: r.uncertainty }]),
  );
  return {
    iteration,
    iterationType,
    phase,
    capturedAt: new Date().toISOString(),
    poolVariantIds: pool.map((v) => v.id),
    ratings: ratingsObj,
    matchCounts: Object.fromEntries(matchCounts),
    ...(options?.discardedVariantIds !== undefined && { discardedVariantIds: options.discardedVariantIds }),
    ...(options?.discardReasons !== undefined && { discardReasons: options.discardReasons }),
    ...(options?.stopReason !== undefined && { stopReason: options.stopReason }),
    ...(options?.budgetAllocated !== undefined && { budgetAllocated: options.budgetAllocated }),
    ...(options?.budgetSpent !== undefined && { budgetSpent: options.budgetSpent }),
  };
}

// ─── Eligibility ─────────────────────────────────────────────────

const ELIGIBILITY_Z_SCORE = 1.04;
const MIN_SWISS_POOL = 3;

function computeEligibleIds(
  pool: ReadonlyArray<Variant>,
  ratings: ReadonlyMap<string, Rating>,
): string[] {
  if (pool.length < 2) return [];
  const sortedByElo = pool
    .map((v) => ({ id: v.id, elo: ratings.get(v.id)?.elo ?? 0 }))
    .sort((a, b) => b.elo - a.elo);
  const top15Cutoff = computeTop15Cutoff(ratings);

  const eligible = sortedByElo.filter(({ id }) => {
    const r = ratings.get(id);
    if (!r) return false;
    return r.elo + ELIGIBILITY_Z_SCORE * r.uncertainty >= top15Cutoff;
  });

  if (eligible.length < MIN_SWISS_POOL) {
    return sortedByElo.slice(0, MIN_SWISS_POOL).map((e) => e.id);
  }
  return eligible.map((e) => e.id);
}

function allConverged(
  eligibleIds: ReadonlyArray<string>,
  ratings: ReadonlyMap<string, Rating>,
): boolean {
  if (eligibleIds.length === 0) return false;
  return eligibleIds.every((id) => {
    const r = ratings.get(id);
    return r ? isConverged(r, DEFAULT_CONVERGENCE_UNCERTAINTY) : false;
  });
}

// ─── Main function ───────────────────────────────────────────────

/**
 * Run the orchestrator-driven evolution pipeline. Iterates over config.iterationConfigs[],
 * dispatching generate or swiss agents per iteration with per-iteration budget tracking.
 */
export async function evolveArticle(
  originalText: string,
  llmProvider: {
    complete(
      prompt: string,
      label: string,
      opts?: { model?: string },
    ): Promise<string | { text: string; usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number } }>;
  },
  db: SupabaseClient,
  runId: string,
  config: EvolutionConfig,
  options?: {
    logger?: EntityLogger;
    initialPool?: Array<Variant & { elo?: number; uncertainty?: number }>;
    experimentId?: string;
    strategyId?: string;
    /** B122: prompt_id for the run; propagated to AgentContext so MergeRatingsAgent can
     *  set it at insert on `evolution_arena_comparisons` rows instead of relying on
     *  sync_to_arena backfill. */
    promptId?: string | null;
    deadlineMs?: number;
    signal?: AbortSignal;
    randomSeed?: bigint;
    /** UUID of the seed variant persisted before the iteration loop (for result tracking). */
    seedVariantId?: string;
    /** B001-S1+S2: shared run-level cost tracker. When supplied, evolveArticle reuses
     *  this tracker instead of creating its own — so seed-phase spend (counted by the
     *  caller) and iteration-loop spend share a single budget envelope. When undefined,
     *  evolveArticle creates its own (legacy / standalone path). */
    costTracker?: V2CostTracker;
  },
): Promise<EvolutionResult> {
  validateConfig(config);

  const tactics = config.strategies && config.strategies.length > 0
    ? config.strategies
    : [...DEFAULT_TACTICS];

  // Apply defaults for legacy fields too (some metric paths still read them).
  const resolvedConfig: EvolutionConfig = {
    ...config,
    iterationConfigs: config.iterationConfigs,
    calibrationOpponents: config.calibrationOpponents ?? 5,
    tournamentTopK: config.tournamentTopK ?? 5,
    strategies: tactics,
  };

  const noopLogger: EntityLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const logger = options?.logger ?? noopLogger;
  // B001-S1+S2: reuse caller-supplied cost tracker so seed-phase spend already deducted
  // by the orchestrator counts against the same budget envelope. Falls back to creating
  // a fresh tracker when called standalone (e.g. tests / run-evolution-local.ts).
  const costTracker = options?.costTracker ?? createCostTracker(resolvedConfig.budgetUsd);
  // No shared LLM client — Agent.run() builds per-invocation scoped clients via rawProvider.
  // B011: generate a random seed when none is passed instead of silently falling back
  // to 0. Previously two concurrent non-seeded runs collided on the same seed and
  // picked identical parents + tactics, undermining the documented reproducibility
  // invariant for seed-less runs (runs without an explicit randomSeed should be
  // independently random, not all collapsing onto seed=0).
  const randomSeed = options?.randomSeed ?? (() => {
    const buf = new BigUint64Array(1);
    // Use crypto.getRandomValues where available (Node 19+ + modern browsers); fall back
    // to Math.random for very old environments. The fallback is still independent per
    // call — just slightly lower-quality randomness.
    if (typeof crypto !== 'undefined' && typeof (crypto as { getRandomValues?: unknown }).getRandomValues === 'function') {
      (crypto as { getRandomValues: (arr: BigUint64Array) => BigUint64Array }).getRandomValues(buf);
      // B007-S1: clamp to signed BIGINT range (max 2^63-1). BigUint64Array yields
      // unsigned 0..2^64-1; values above 2^63-1 fail the Postgres BIGINT write at
      // finalize. Mask the high bit using BigInt literal.
      return buf[0]! & BigInt('0x7fffffffffffffff');
    }
    return BigInt(Math.floor(Math.random() * 2 ** 53));
  })();

  logger.info('Config validation passed', {
    budgetUsd: resolvedConfig.budgetUsd,
    generationModel: resolvedConfig.generationModel, judgeModel: resolvedConfig.judgeModel,
    tactics,
    phaseName: 'config_validation',
  });

  // Local state
  const pool: Variant[] = [];
  const ratings = new Map<string, Rating>();
  const matchCounts = new Map<string, number>();
  const allMatches: V2Match[] = [];
  const eloHistory: number[][] = [];
  // Phase 4b: parallel array — uncertainty values matching topKEloValues' ranking by elo.
  // Enables EloTab to render an uncertainty band around each line.
  const uncertaintyHistory: number[][] = [];
  const diversityHistory: number[] = [];
  const comparisonCache = new Map<string, ComparisonResult>();
  const completedPairs = new Set<string>();
  const iterationSnapshots: IterationSnapshot[] = [];
  const discardedVariants: Variant[] = [];
  const discardedLocalRatings = new Map<string, Rating>();
  const iterationResults: IterationResult[] = [];

  // Seed variant is no longer added to the pool — it serves only as generation source text.
  // Seed generation is handled in claimAndExecuteRun (pre-iteration setup).

  // Load initial pool entries (e.g., arena entries with existing ratings).
  if (options?.initialPool) {
    for (const entry of options.initialPool) {
      pool.push(entry);
      ratings.set(entry.id,
        entry.elo !== undefined && entry.uncertainty !== undefined
          ? { elo: entry.elo, uncertainty: entry.uncertainty }
          : createRating(),
      );
    }
    logger.info('Initial pool loaded', { entriesLoaded: options.initialPool.length, poolSize: pool.length, phaseName: 'initialization' });
  }

  let stopReason: EvolutionResult['stopReason'] = 'completed';
  let iteration = 0;
  let executionOrder = 0;
  // Dispatch-count observables for projected-vs-actual Budget Floor Sensitivity.
  let parallelDispatchedCount = 0;
  let sequentialDispatchedCount = 0;
  let actualAvgCostPerAgent: number | null = null;

  const totalBudget = resolvedConfig.budgetUsd;
  const initialAgentCostEstimate = estimateAgentCost(
    originalText.length, tactics[0]!, resolvedConfig.generationModel,
    resolvedConfig.judgeModel, 1, resolvedConfig.maxComparisonsPerVariant ?? 15,
  );

  // ─── Config-driven iteration loop ─────────────────────────────
  for (let iterIdx = 0; iterIdx < resolvedConfig.iterationConfigs.length; iterIdx++) {
    const iterCfg = resolvedConfig.iterationConfigs[iterIdx]!;
    const iterBudgetUsd = (iterCfg.budgetPercent / 100) * totalBudget;
    const iterTracker = createIterationBudgetTracker(iterBudgetUsd, costTracker, iterIdx);

    // Kill / abort / deadline checks at iteration boundary
    if (options?.signal?.aborted) {
      logger.warn('Run aborted via signal', { iteration: iterIdx + 1, phaseName: 'loop' });
      stopReason = 'killed';
      break;
    }
    if (await isRunKilled(db, runId, logger)) {
      logger.warn('Run killed externally', { iteration: iterIdx + 1, phaseName: 'loop' });
      stopReason = 'killed';
      break;
    }
    if (options?.deadlineMs && Date.now() >= options.deadlineMs) {
      logger.warn('Wall clock deadline reached', { iteration: iterIdx + 1, phaseName: 'loop' });
      stopReason = 'deadline';
      break;
    }

    iteration++;
    const iterType = iterCfg.agentType;
    logger.info(`Starting iteration ${iteration} (${iterType})`, { iteration, iterIdx, budgetUsd: iterBudgetUsd, phaseName: 'loop' });

    // Snapshot at iteration start
    iterationSnapshots.push(recordSnapshot(iteration, iterType, 'start', pool, ratings, matchCounts, {
      budgetAllocated: iterBudgetUsd,
    }));

    let iterStopReason: IterationStopReason = 'iteration_complete';
    let iterVariantsCreated = 0;
    let iterMatchesCompleted = 0;

    try {
      // Both 'generate' and 'reflect_and_generate' are variant-producing iterations
      // sharing the same parallel-batch + top-up + merge dispatch shape. The only
      // difference is which agent class gets dispatched per call (decided inside
      // dispatchOneAgent below based on `reflectionEnabled`).
      if (iterType === 'generate' || iterType === 'reflect_and_generate' || iterType === 'criteria_and_generate' || iterType === 'single_pass_evaluate_criteria_and_generate' || iterType === 'proposer_approver_criteria_generate') {
        // ─── Generate / reflect-and-generate iteration ────────
        // Phase 7b: restructured to accumulate parallel + top-up match buffers, then
        // invoke MergeRatingsAgent ONCE at iteration end over the combined buffers.
        // Top-up agents reuse the iteration-start snapshot (option A in decision #8) so
        // there's no data dependency requiring an intermediate merge.
        const initialPoolSnapshot: Variant[] = [...pool];
        const initialRatingsSnapshot = new Map(ratings);
        const initialMatchCountsSnapshot = new Map(matchCounts);

        // Read EVOLUTION_TOPUP_ENABLED once per iteration (not per dispatch). Default
        // true; set to 'false' as a rollback kill-switch if top-up misbehaves in prod.
        const topUpEnabled = process.env.EVOLUTION_TOPUP_ENABLED !== 'false';

        // Shape A of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430:
        // resolve reflection dispatch via a pure helper (resolveReflectionEnabled) so the
        // kill-switch + agentType conjunction is unit-testable in isolation. ONCE per iteration.
        const reflectionEnabled = resolveReflectionEnabled(iterCfg, process.env);
        const reflectionTopN = iterCfg.reflectionTopN ?? 3;

        // Pre-fetch tactic ELO boosts ONCE per iteration when reflection is enabled.
        // The same Map reference is shared by all DISPATCH_SAFETY_CAP=100 parallel
        // wrapper agents, so we don't issue 100 redundant queries per iteration.
        let tacticEloBoosts: Map<string, number | null> = new Map();
        if (reflectionEnabled && options?.promptId) {
          try {
            tacticEloBoosts = await getTacticEloBoostsForReflection(
              db,
              options.promptId,
              ALL_TACTIC_NAMES,
              logger,
            );
          } catch (err) {
            logger.warn('Phase 7 reflection ELO boost fetch failed; reflection prompt will show "—"', {
              phaseName: 'reflection_prep',
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Phase 4: pre-fetch criteria rows ONCE per iteration when this is a
        // criteria_and_generate iteration. Same Map shared across all parallel agents.
        let evaluationCriteria: Map<string, EvolutionCriterionRow> = new Map();
        if ((iterCfg.agentType === 'criteria_and_generate' || iterCfg.agentType === 'single_pass_evaluate_criteria_and_generate' || iterCfg.agentType === 'proposer_approver_criteria_generate') && iterCfg.criteriaIds && iterCfg.criteriaIds.length > 0) {
          try {
            evaluationCriteria = await getCriteriaForEvaluation(db, iterCfg.criteriaIds, logger);
          } catch (err) {
            logger.warn('Phase 4 criteria fetch failed; iteration will fail at validation', {
              phaseName: 'criteria_prep',
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Budget-aware parallel-batch size: compute how many agents we can afford
        // within iteration budget AT UPPER-BOUND cost (reservation safety).
        // Phase 3 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430:
        // include the reflection LLM call cost for reflect_and_generate iterations so
        // dispatch sizing accounts for the extra ~$0.0005-0.001/agent. Reuse the
        // iteration-scoped reflectionEnabled/reflectionTopN values resolved above.
        const availBudget = iterTracker.getAvailableBudget();
        const maxComp = resolvedConfig.maxComparisonsPerVariant ?? 15;
        const useCriteria = iterCfg.agentType === 'criteria_and_generate' || iterCfg.agentType === 'single_pass_evaluate_criteria_and_generate' || iterCfg.agentType === 'proposer_approver_criteria_generate';
        const useSinglePassCriteria = iterCfg.agentType === 'single_pass_evaluate_criteria_and_generate';
        const criteriaCount = iterCfg.criteriaIds?.length ?? 0;
        const weakestK = iterCfg.weakestK ?? 1;
        const estPerAgent = estimateAgentCost(
          originalText.length, tactics[0]!, resolvedConfig.generationModel,
          resolvedConfig.judgeModel, pool.length, maxComp,
          reflectionEnabled, reflectionTopN,
          useCriteria, criteriaCount, weakestK,
        );
        const maxAffordable = Math.max(1, Math.floor(availBudget / estPerAgent));
        // DISPATCH_SAFETY_CAP is a defense-in-depth rail; budget is the primary governor.
        const parallelDispatchCount = Math.min(DISPATCH_SAFETY_CAP, maxAffordable);

        // Select tactics: per-iteration guidance takes precedence over strategy-level, then round-robin.
        const guidance = iterCfg.generationGuidance ?? resolvedConfig.generationGuidance;
        const selectTactic = (i: number): string => {
          if (guidance && guidance.length > 0) {
            const rng = new SeededRandom(deriveSeed(randomSeed, `iter${iteration}`, `tactic_sel${i}`));
            return selectTacticWeighted(guidance, rng);
          }
          return tactics[i % tactics.length]!;
        };

        const parallelTactics = Array.from({ length: parallelDispatchCount }, (_, i) => selectTactic(i));
        logger.info('Dispatching generate iteration (parallel batch)', {
          iteration, iterIdx,
          parallelDispatchCount, maxAffordable, safetyCap: DISPATCH_SAFETY_CAP,
          iterBudgetUsd, availBudget, estPerAgent,
          tactics: parallelTactics,
          topUpEnabled,
          selectionMode: guidance ? (iterCfg.generationGuidance ? 'iteration-weighted' : 'strategy-weighted') : 'round-robin',
          phaseName: 'generation',
        });

        const iterSourceMode = iterCfg.sourceMode ?? 'seed';
        const iterQualityCutoff = iterCfg.qualityCutoff;
        const seedVariantForResolve = { id: options?.seedVariantId ?? '', text: originalText };

        // Bug fix (20260421): in pool mode, parents must be drawn from variants
        // produced by THIS run only — never from arena entries that came from prior
        // runs of the same prompt. Arena entries still participate in ranking
        // (in-iteration rankSingleVariant uses `initialPoolSnapshot` unfiltered),
        // they're just excluded as candidate *parents*. Computed once per iteration;
        // reused by both the parallel batch and top-up dispatches below.
        const inRunPool = initialPoolSnapshot.filter((v) => !v.fromArena);
        const poolForParentResolve = iterSourceMode === 'pool' ? inRunPool : initialPoolSnapshot;
        // True when the unfiltered pool had only arena entries. We'll emit a richer
        // 'no_same_run_variants' log at the call site and suppress resolveParent's
        // generic 'empty pool' warn for this specific case so ops see one log per
        // dispatch, not two.
        const arenaOnlyPool = iterSourceMode === 'pool' && initialPoolSnapshot.length > 0 && inRunPool.length === 0;

        // Helper: build the AgentContext + kick off one GFSA agent run.
        const dispatchOneAgent = (tactic: string, phase: 'parallel' | 'top_up') => {
          const execOrder = ++executionOrder;
          const pickRng = createSeededRng(hashSeed(runId, iteration, execOrder));
          const resolved = resolveParent({
            sourceMode: iterSourceMode,
            qualityCutoff: iterQualityCutoff,
            seedVariant: seedVariantForResolve,
            pool: poolForParentResolve,
            ratings: initialRatingsSnapshot,
            rng: pickRng,
            warn: (msg, c) => {
              // Suppress resolveParent's generic 'empty pool' warn when we'll emit
              // a richer same-run-specific warn below — otherwise both fire per
              // dispatch and double the log volume.
              if (arenaOnlyPool && msg.includes('empty pool')) return;
              logger.warn(msg, { ...c, phaseName: 'generation', iteration, execOrder, dispatchPhase: phase });
            },
          });
          // Relabel the generic empty_pool fallback when the real cause was "we
          // filtered out arena entries and nothing in-run was left". Gives operators
          // a distinct log string to grep for without changing resolveParent's type.
          if (arenaOnlyPool && resolved.fallbackReason === 'empty_pool') {
            logger.warn('resolveParent: no same-run variants available, fell back to seed', {
              phaseName: 'generation',
              iteration,
              execOrder,
              dispatchPhase: phase,
              fallbackReason: 'no_same_run_variants',
              inRunSize: 0,
              arenaFilteredCount: initialPoolSnapshot.length,
            });
          }
          const ctxForAgent: AgentContext = {
            db, runId, iteration,
            executionOrder: execOrder,
            invocationId: '',
            randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `gfsa${execOrder}`),
            logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
            experimentId: options?.experimentId,
            strategyId: options?.strategyId,
            agentIndex: execOrder,
            rawProvider: llmProvider,
            defaultModel: resolvedConfig.generationModel,
            generationTemperature: resolvedConfig.generationTemperature,
            // Phase 7: pass tacticEloBoosts so the wrapper agent can read it directly
            // from extendedCtx if needed. Currently the wrapper reads from input.tacticEloBoosts
            // (built below), but this is here for consistency with future agents.
            tacticEloBoosts: reflectionEnabled ? tacticEloBoosts : undefined,
          };
          // Phase 7: branch agent + input shape based on iteration's reflection config.
          // Both branches share the same ctxForAgent and the same parent-resolution path
          // — only the agent class and input differ.
          if (iterCfg.agentType === 'criteria_and_generate') {
            const wrapperAgent = new EvaluateCriteriaThenGenerateFromPreviousArticleAgent();
            return wrapperAgent.run({
              parentText: resolved.text,
              parentVariantId: resolved.variantId,
              criteria: Array.from(evaluationCriteria.values()),
              criteriaIds: iterCfg.criteriaIds ?? [],
              weakestK: iterCfg.weakestK ?? 1,
              initialPool: initialPoolSnapshot,
              initialRatings: initialRatingsSnapshot,
              initialMatchCounts: initialMatchCountsSnapshot,
              cache: comparisonCache,
            }, ctxForAgent);
          }
          if (iterCfg.agentType === 'proposer_approver_criteria_generate') {
            const proposerApproverEnabled = process.env.EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED !== 'false';
            if (!proposerApproverEnabled) {
              logger.warn('Propose/approve criteria agent disabled via env; iteration produces zero variants', {
                phaseName: 'proposer_approver_kill_switch',
                iteration,
              });
              // Reject the iteration cleanly — return null (no variant).
              throw new Error('proposer_approver_criteria_generate disabled via EVOLUTION_PROPOSER_APPROVER_CRITERIA_ENABLED=false');
            }
            const wrapperAgent = new ProposerApproverCriteriaGenerateAgent();
            return wrapperAgent.run({
              parentText: resolved.text,
              parentVariantId: resolved.variantId,
              criteria: Array.from(evaluationCriteria.values()),
              criteriaIds: iterCfg.criteriaIds ?? [],
              weakestK: iterCfg.weakestK ?? 1,
              lengthCapRatio: iterCfg.lengthCapRatio,
              redundancyJaccardThreshold: iterCfg.redundancyJaccardThreshold,
              includesMirrorApprover: iterCfg.includesMirrorApprover,
              initialPool: initialPoolSnapshot,
              initialRatings: initialRatingsSnapshot,
              initialMatchCounts: initialMatchCountsSnapshot,
              cache: comparisonCache,
            }, ctxForAgent);
          }
          if (iterCfg.agentType === 'single_pass_evaluate_criteria_and_generate') {
            // Honor kill-switch: env=false falls back to legacy wrapper.
            const singlePassEnabled = process.env.EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED !== 'false';
            if (!singlePassEnabled) {
              logger.warn('Single-pass criteria agent disabled via env; falling back to legacy criteria_and_generate', {
                phaseName: 'single_pass_kill_switch',
                iteration,
              });
              const fallback = new EvaluateCriteriaThenGenerateFromPreviousArticleAgent();
              return fallback.run({
                parentText: resolved.text,
                parentVariantId: resolved.variantId,
                criteria: Array.from(evaluationCriteria.values()),
                criteriaIds: iterCfg.criteriaIds ?? [],
                weakestK: iterCfg.weakestK ?? 1,
                initialPool: initialPoolSnapshot,
                initialRatings: initialRatingsSnapshot,
                initialMatchCounts: initialMatchCountsSnapshot,
                cache: comparisonCache,
              }, ctxForAgent);
            }
            const wrapperAgent = new SinglePassEvaluateCriteriaAndGenerateAgent();
            return wrapperAgent.run({
              parentText: resolved.text,
              parentVariantId: resolved.variantId,
              criteria: Array.from(evaluationCriteria.values()),
              criteriaIds: iterCfg.criteriaIds ?? [],
              weakestK: iterCfg.weakestK ?? 1,
              initialPool: initialPoolSnapshot,
              initialRatings: initialRatingsSnapshot,
              initialMatchCounts: initialMatchCountsSnapshot,
              cache: comparisonCache,
            }, ctxForAgent);
          }
          if (reflectionEnabled) {
            const shuffleSeed = deriveSeed(randomSeed, `iter${iteration}`, `reflect_shuffle${execOrder}`);
            const rng = new SeededRandom(shuffleSeed);
            // ALL_SYSTEM_TACTICS is a Record<string, TacticDef> — TacticDef has no `name` field
            // (the name is the Record key). Use Object.entries() to keep both attached.
            const tacticEntries = Object.entries(ALL_SYSTEM_TACTICS);
            const shuffled = rng.shuffle([...tacticEntries]);
            const candidates: TacticCandidate[] = shuffled.map(([name, def]) => ({
              name,
              label: def.label,
              summary: getTacticSummary(name) ?? `${def.label} — ${def.preamble}`,
            }));
            const wrapperAgent = new ReflectAndGenerateFromPreviousArticleAgent();
            return wrapperAgent.run({
              parentText: resolved.text,
              parentVariantId: resolved.variantId,
              tacticCandidates: candidates,
              tacticEloBoosts,
              reflectionTopN,
              initialPool: initialPoolSnapshot,
              initialRatings: initialRatingsSnapshot,
              initialMatchCounts: initialMatchCountsSnapshot,
              cache: comparisonCache,
            }, ctxForAgent);
          }
          const agent = new GenerateFromPreviousArticleAgent();
          return agent.run({
            parentText: resolved.text,
            tactic,
            initialPool: initialPoolSnapshot,
            initialRatings: initialRatingsSnapshot,
            initialMatchCounts: initialMatchCountsSnapshot,
            cache: comparisonCache,
            parentVariantId: resolved.variantId,
          }, ctxForAgent);
        };

        // ─── Parallel batch ─────────────────────────────────────
        const parallelPromises = parallelTactics.map((t) => dispatchOneAgent(t, 'parallel'));
        const parallelResults = await Promise.allSettled(parallelPromises);

        // Accumulate surfaced + discarded from parallel batch. Do NOT merge yet.
        const surfacedVariants: Variant[] = [];
        const surfacedBuffers: MergeMatchEntry[][] = [];
        const discardedIds: string[] = [];
        const discardReasonsMap: Record<string, { elo: number; top15Cutoff: number }> = {};
        let parallelSpend = 0;
        let parallelSuccesses = 0;
        let topUpDispatched = 0;
        let topUpStopReason: 'floor' | 'safety_cap' | 'budget_exhausted' | 'killed' | 'deadline' | 'no_budget_at_start' | 'feature_disabled' | 'top_up_dispatch_failed' | null = null;

        const absorbResult = (r: PromiseSettledResult<Awaited<ReturnType<GenerateFromPreviousArticleAgent['run']>>>): boolean => {
          // Returns true if a fatal run-level error should re-throw.
          if (r.status === 'rejected') {
            if (r.reason instanceof IterationBudgetExceededError) {
              iterStopReason = 'iteration_budget_exceeded';
              return false;
            }
            if (r.reason instanceof BudgetExceededError) {
              throw r.reason;
            }
            logger.warn('generateFromPreviousArticle agent rejected', {
              phaseName: 'generation',
              error: (r.reason instanceof Error ? r.reason.message : String(r.reason)).slice(0, 500),
            });
            return false;
          }
          if (r.value.budgetExceeded) { iterStopReason = 'iteration_budget_exceeded'; return false; }
          if (!r.value.success || !r.value.result) return false;

          const out = r.value.result;
          if (out.surfaced && out.variant) {
            surfacedVariants.push(out.variant);
            surfacedBuffers.push(out.matches.map((m) => ({ match: m, idA: m.winnerId, idB: m.loserId })));
          } else if (out.variant && !out.surfaced) {
            discardedVariants.push(out.variant);
            discardedIds.push(out.variant.id);
            if (out.discardReason) discardReasonsMap[out.variant.id] = out.discardReason;
            if (out.localRating) discardedLocalRatings.set(out.variant.id, out.localRating);
          }
          return false;
        };

        for (const r of parallelResults) {
          absorbResult(r);
          if (r.status === 'fulfilled' && r.value.success && r.value.cost > 0) {
            parallelSpend += r.value.cost;
            parallelSuccesses += 1;
          }
        }

        // Measure actualAvgCostPerAgent from parallel batch's real spends.
        let actualAvgCost: number | null = null;
        if (parallelSuccesses > 0) {
          actualAvgCost = parallelSpend / parallelSuccesses;
          // B006-S1: drop the `iterIdx === 0` guard. Budget-floor observables benefit
          // from the latest-iteration sample, not just iter-0. When iter 0 was swiss
          // (no parallel dispatch) or had zero successes, this previously left
          // actualAvgCostPerAgent null forever.
          actualAvgCostPerAgent = actualAvgCost;
        }
        // B003: key the estPerAgent fallback on `parallelSuccesses === 0`, not on the
        // measured value. A legitimately cheap parallel batch (actual spend ≈ 0) was
        // previously falsy-treated and overwritten by the initial estimate, inflating
        // top-up per-agent cost and shrinking sequential headroom.
        if (parallelSuccesses === 0) {
          logger.warn('actualAvgCostPerAgent fallback to initialAgentCostEstimate', {
            phaseName: 'generation', iteration, iterIdx, parallelSuccesses,
            reason: 'no_successful_parallel_agents',
          });
          actualAvgCost = estPerAgent;
        } else if (!actualAvgCost || !Number.isFinite(actualAvgCost)) {
          // Only NaN / non-finite — not just "small" — triggers a defensive fallback.
          logger.warn('actualAvgCostPerAgent non-finite despite successes — fallback', {
            phaseName: 'generation', iteration, iterIdx, parallelSuccesses, actualAvgCost,
          });
          actualAvgCost = estPerAgent;
        }

        // ─── Top-up phase ───────────────────────────────────────
        if (topUpEnabled && iterStopReason === 'iteration_complete') {
          // Kill / deadline check before entering top-up loop.
          if (options?.signal?.aborted) {
            topUpStopReason = 'killed';
          } else if (options?.deadlineMs && Date.now() >= options.deadlineMs) {
            topUpStopReason = 'deadline';
          } else if (await isRunKilled(db, runId, logger)) {
            topUpStopReason = 'killed';
          }

          if (topUpStopReason === null) {
            const sequentialFloor = resolveSequentialFloor(
              resolvedConfig, iterBudgetUsd, estPerAgent, actualAvgCost,
            );
            let topUpSpend = 0;
            let remaining = iterBudgetUsd - parallelSpend - topUpSpend;

            while (remaining - actualAvgCost >= sequentialFloor) {
              // Safety cap (parallel + top-up total).
              if (parallelDispatchCount + topUpDispatched >= DISPATCH_SAFETY_CAP) {
                topUpStopReason = 'safety_cap';
                break;
              }
              // Bounded kill-check: every 5 top-up dispatches hit the DB.
              if (topUpDispatched > 0 && topUpDispatched % 5 === 0) {
                if (options?.signal?.aborted) { topUpStopReason = 'killed'; break; }
                if (options?.deadlineMs && Date.now() >= options.deadlineMs) { topUpStopReason = 'deadline'; break; }
                if (await isRunKilled(db, runId, logger)) { topUpStopReason = 'killed'; break; }
              }
              // Cheap per-dispatch signal check.
              if (options?.signal?.aborted) { topUpStopReason = 'killed'; break; }

              const topUpTactic = selectTactic(parallelDispatchCount + topUpDispatched);
              const topUpResult = await Promise.allSettled([dispatchOneAgent(topUpTactic, 'top_up')]);
              absorbResult(topUpResult[0]!);

              if (topUpResult[0]!.status === 'fulfilled' && topUpResult[0]!.value.success) {
                topUpSpend += topUpResult[0]!.value.cost;
                topUpDispatched += 1;
              } else {
                // B011-S1: distinguish budget exhaustion from LLM/agent failure. Previously
                // hardcoded 'budget_exhausted' for any non-success, mislabeling LLM 5xx as
                // a budget event in dashboards. The IterationBudgetExceededError path is
                // already handled separately upstream — non-success here is an agent crash.
                const reason = topUpResult[0]!.status === 'rejected'
                  && (topUpResult[0]!.reason as Error)?.name === 'BudgetExceededError'
                  ? 'budget_exhausted'
                  : 'top_up_dispatch_failed';
                topUpStopReason = reason;
                break;
              }
              remaining = iterBudgetUsd - parallelSpend - topUpSpend;
            }
            if (topUpStopReason === null) topUpStopReason = 'budget_exhausted';

            logger.info('Top-up loop complete', {
              phaseName: 'generation', iteration, iterIdx,
              parallelDispatched: parallelDispatchCount,
              topUpDispatched,
              topUpStopReason,
              actualAvgCost, sequentialFloor,
              remainingIterBudget: remaining,
            });
          }
        } else if (!topUpEnabled) {
          topUpStopReason = 'feature_disabled';
        }

        iterVariantsCreated = surfacedVariants.length;

        // Update observables: iter 0 = parallel bucket, later iters = sequential bucket,
        // consistent with pre-Phase-7 labeling. Total dispatches per iter = parallel + top-up.
        const totalIterDispatches = parallelDispatchCount + topUpDispatched;
        if (iterIdx === 0) {
          parallelDispatchedCount = totalIterDispatches;
        } else {
          sequentialDispatchedCount += totalIterDispatches;
        }

        // ─── Pre-merge spend log ────────────────────────────────
        // If the merge throws, the wasted cost is attributable from logs even without
        // persisted invocation rows.
        logger.info('iteration pre-merge accounting', {
          phaseName: 'generation', iteration, iterIdx,
          parallelBatchSize: parallelDispatchCount, topUpBatchSize: topUpDispatched,
          parallelSpend, topUpSpend: iterTracker.getTotalSpent() - parallelSpend,
          totalIterSpend: iterTracker.getTotalSpent(),
        });

        // ─── Single merge pass over combined buffers ────────────
        const mergeExecOrder = ++executionOrder;
        const mergeCtx: AgentContext = {
          db, runId, iteration,
          executionOrder: mergeExecOrder,
          invocationId: '',
          randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
          logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
          experimentId: options?.experimentId,
          strategyId: options?.strategyId,
        };
        const mergeAgent = new MergeRatingsAgent();
        // Per Decisions §7: pass the actual iteration type through to MergeRatings so
        // execution_detail.iterationType matches IterationSnapshot.iterationType. The
        // generate branch handles BOTH 'generate' and 'reflect_and_generate' iterations
        // (see if-condition above); pass iterType through to keep observability
        // consistent across snapshot and merge-detail enums.
        const mergeIterType: 'generate' | 'reflect_and_generate' =
          iterType === 'reflect_and_generate' ? 'reflect_and_generate' : 'generate';
        const mergeResult = await mergeAgent.run({
          iterationType: mergeIterType,
          matchBuffers: surfacedBuffers,
          newVariants: surfacedVariants,
          pool, ratings, matchCounts, matchHistory: allMatches,
        }, mergeCtx);

        if (mergeResult.budgetExceeded) iterStopReason = 'iteration_budget_exceeded';

        // Track top-K elo history and snapshot iteration end (with discarded info).
        const topK = resolvedConfig.tournamentTopK ?? 5;
        const eloValues = topKEloValues(ratings, topK);
        eloHistory.push(eloValues);
        // B005-S1: populate uncertaintyHistory in lockstep with eloHistory so the EloTab
        // uncertainty band has data. Previously declared but never pushed → arrays were
        // always empty in run_summary, silently breaking the EloTab feature.
        uncertaintyHistory.push(topKUncertainties(ratings, topK));

        iterationSnapshots.push(recordSnapshot(iteration, 'generate', 'end', pool, ratings, matchCounts, {
          discardedVariantIds: discardedIds,
          discardReasons: discardReasonsMap,
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
        }));

        logger.info('Generate iteration complete', {
          iteration, iterIdx,
          surfaced: surfacedVariants.length,
          discarded: discardedIds.length,
          iterStopReason,
          budgetSpent: iterTracker.getTotalSpent(),
          topEloValues: eloValues.slice(0, 5),
          phaseName: 'generation',
        });

      } else if (iterType === 'iterative_editing' || iterType === 'iterative_editing_rewrite') {
        // ─── Iterative editing iteration ──────────────────────────
        // Per-parent: dispatch one IterativeEditingAgent per eligible top-Elo parent.
        // Each invocation runs up to maxCycles propose-review-apply cycles in-memory;
        // only the FINAL cycle's text materializes as a Variant per Decisions §14.
        // Per Decisions §15: each invocation receives perInvocationBudgetUsd =
        // remainingBudget / parallelDispatchCount to prevent starvation under
        // shared IterationBudgetTracker.
        if (process.env.EDITING_AGENTS_ENABLED === 'false') {
          // Soft rollback per Rollout/Rollback section: short-circuit at branch entry.
          logger.info('Iterative-editing iteration short-circuited (EDITING_AGENTS_ENABLED=false)', {
            iteration, iterIdx, phaseName: 'editing',
          });
          iterStopReason = 'iteration_complete';
        } else {
          // Mode B (iterative_editing_rewrite) rollback gate: when the env flag
          // is set, fall Mode B back to Mode A at runtime. Read per-invocation
          // (no caching) so the flag flip takes effect on the next invocation.
          const disableRewrite = process.env.DISABLE_ITERATIVE_EDITING_REWRITE === 'true';
          const useRewriteMode = iterType === 'iterative_editing_rewrite' && !disableRewrite;
          const { IterativeEditingAgent } = await import('../../core/agents/editing/IterativeEditingAgent');
          const { IterativeEditingRewriteAgent } = await import('../../core/agents/editing/IterativeEditingRewriteAgent');
          const { resolveEditingDispatchRuntime, resolveEditingRankEnabled } = await import('./editingDispatch');

          // D4 — runtime gate for the post-cycle ranking step. When 'false' the
          // dispatch site OMITS rank-context fields from IterativeEditInput so the
          // agent's input-presence gate skips ranking. Default-true.
          const editingRankEnabled = resolveEditingRankEnabled(process.env);

          // Compute eligible parents via shared helper (same call site as planner).
          const arenaVariantIds = new Set<string>(); // Editing iterations don't add arena entries.
          const dispatch = resolveEditingDispatchRuntime({
            pool,
            arenaVariantIds,
            iterationStartRatings: ratings,
            cutoff: iterCfg.editingEligibilityCutoff,
          });

          if (dispatch.eligibleParents.length === 0) {
            logger.warn('Iterative-editing: no eligible parents after cutoff', {
              iteration, iterIdx, poolSize: pool.length, phaseName: 'editing',
            });
            iterStopReason = 'iteration_no_pairs';
          } else {
            // Cap dispatch count by eligible-parents count and DISPATCH_SAFETY_CAP.
            // Per-invocation budget split: divide remaining iter budget across invocations
            // per Decisions §15 (prevents starvation under shared IterationBudgetTracker).
            const dispatchCount = Math.min(dispatch.eligibleParents.length, DISPATCH_SAFETY_CAP);
            const remainingBudget = Math.max(0, iterBudgetUsd - iterTracker.getTotalSpent());
            const perInvocationBudgetUsd = dispatchCount > 0
              ? remainingBudget / dispatchCount
              : 0;

            const editingAgent = useRewriteMode
              ? new IterativeEditingRewriteAgent()
              : new IterativeEditingAgent();
            const newVariants: Variant[] = [];
            // Phase 4.2 — match buffers populated by per-agent ranking output (D7:
            // one final-variant ranking per invocation). Empty when editingRankEnabled=false
            // or when no surfaced final variant came back.
            const editingMatchBuffers: MergeMatchEntry[][] = [];

            // Phase 4.1 — when ranking enabled, capture iteration-start snapshots ONCE
            // and pass them (deep-cloned per agent inside the agent) into IterativeEditInput.
            // The agent's input-presence gate (Phase 2.3) skips ranking if any rank-context
            // field is absent, so omitting them when editingRankEnabled=false is sufficient.
            const initialPoolSnapshot: ReadonlyArray<Variant> | undefined = editingRankEnabled ? pool : undefined;
            const initialRatingsSnapshot: ReadonlyMap<string, Rating> | undefined = editingRankEnabled ? ratings : undefined;
            const initialMatchCountsSnapshot: ReadonlyMap<string, number> | undefined = editingRankEnabled ? matchCounts : undefined;

            // Parallel dispatch via Promise.allSettled.
            const parallelParents = dispatch.eligibleParents.slice(0, dispatchCount);
            const dispatchPromises = parallelParents.map(async (parent) => {
              const editExecOrder = ++executionOrder;
              const editCtx: AgentContext = {
                db, runId, iteration,
                executionOrder: editExecOrder,
                invocationId: '',
                randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `edit${editExecOrder}`),
                logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
                experimentId: options?.experimentId,
                strategyId: options?.strategyId,
                rawProvider: llmProvider,
                defaultModel: (resolvedConfig as { editingModel?: string }).editingModel ?? resolvedConfig.generationModel,
                generationTemperature: resolvedConfig.generationTemperature,
              };
              return editingAgent.run({
                parent,
                perInvocationBudgetUsd,
                // Rank-context fields — omitted when editingRankEnabled=false (input-presence gate skips ranking).
                ...(initialPoolSnapshot !== undefined ? { initialPool: initialPoolSnapshot } : {}),
                ...(initialRatingsSnapshot !== undefined ? { initialRatings: initialRatingsSnapshot } : {}),
                ...(initialMatchCountsSnapshot !== undefined ? { initialMatchCounts: initialMatchCountsSnapshot } : {}),
                ...(editingRankEnabled ? { cache: comparisonCache, parentVariantId: parent.id } : {}),
              }, editCtx);
            });

            const settled = await Promise.allSettled(dispatchPromises);
            for (const s of settled) {
              if (s.status === 'fulfilled' && s.value.success && s.value.result) {
                const r = s.value.result as {
                  finalVariant: Variant | null;
                  surfaced: boolean;
                  matches?: ReadonlyArray<V2Match>;
                  discardReason?: { localElo: number; localTop15Cutoff: number };
                };
                if (r.finalVariant !== null && r.surfaced) {
                  newVariants.push(r.finalVariant);
                  iterVariantsCreated++;
                } else if (r.finalVariant !== null && !r.surfaced) {
                  // Mirror generate branch (lines 660-665): collect non-surfaced
                  // editing variants so the persistence layer can write them as
                  // persisted=false rows. Without this, ranked-and-discarded
                  // editing variants vanish and survivorship bias creeps into
                  // parent→child Elo metrics.
                  discardedVariants.push(r.finalVariant);
                }
                // Phase 4.2 — collect ranking matches into the merge buffer
                // (mirrors generate-branch line 561). Empty array when ranking skipped.
                if (r.matches && r.matches.length > 0) {
                  editingMatchBuffers.push(
                    r.matches.map((m) => ({ match: m, idA: m.winnerId, idB: m.loserId })),
                  );
                }
                if (s.value.budgetExceeded) {
                  iterStopReason = 'iteration_budget_exceeded';
                }
              }
            }

            // Merge — pass the actual iterType so Mode A vs Mode B remain
            // distinguishable in execution_detail (analytics/run-detail key
            // off iterationType).
            if (newVariants.length > 0) {
              const mergeExecOrder = ++executionOrder;
              const mergeCtx: AgentContext = {
                db, runId, iteration,
                executionOrder: mergeExecOrder,
                invocationId: '',
                randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
                logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
                experimentId: options?.experimentId,
                strategyId: options?.strategyId,
              };
              const mergeAgent = new MergeRatingsAgent();
              await mergeAgent.run({
                iterationType: iterType,
                matchBuffers: editingMatchBuffers,
                newVariants,
                pool, ratings, matchCounts, matchHistory: allMatches,
              }, mergeCtx);
            }
          }
        }

        const topKEditing = resolvedConfig.tournamentTopK ?? 5;
        const eloValues = topKEloValues(ratings, topKEditing);
        eloHistory.push(eloValues);

        iterationSnapshots.push(recordSnapshot(iteration, iterType, 'end', pool, ratings, matchCounts, {
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
        }));

        logger.info('Iterative-editing iteration complete', {
          iteration, iterIdx,
          variantsCreated: iterVariantsCreated,
          iterStopReason,
          budgetSpent: iterTracker.getTotalSpent(),
          topEloValues: eloValues.slice(0, 5),
          phaseName: 'editing',
        });

      } else if (iterType === 'debate_and_generate') {
        // ─── Debate iteration ─────────────────────────────────
        // bring_back_debate_agent_20260506 Phase 3.2 — single materialized variant per
        // invocation (Decision §15). Top-2 selected from iteration-start pool snapshot
        // by Elo desc with deterministic id-tiebreak (Decision §12 + §16). Kill-switch
        // EVOLUTION_DEBATE_ENABLED falls through to no-op when 'false' (Decision §11).
        const { resolveDebateDispatchRuntime, resolveDebateEnabled } =
          await import('./debateDispatch');
        const { DebateThenGenerateFromPreviousArticleAgent } =
          await import('../../core/agents/debate/DebateAgent');

        const debateEnabled = resolveDebateEnabled(process.env);
        if (!debateEnabled) {
          logger.info('Debate iteration skipped — EVOLUTION_DEBATE_ENABLED=false', {
            iteration, iterIdx, phaseName: 'debate',
          });
          iterStopReason = 'iteration_complete';
        } else {
          // Top-2 selection from iteration-start pool snapshot.
          const arenaVariantIds = new Set<string>(
            pool.filter((v) => v.fromArena === true).map((v) => v.id),
          );
          const dispatchResult = resolveDebateDispatchRuntime({
            pool,
            arenaVariantIds,
            iterationStartRatings: ratings,
          });
          if (!dispatchResult) {
            // Pool too small — gate failure; iteration ends with no new variant.
            logger.warn('Debate iteration gate failed — fewer than 2 eligible non-arena rated variants in pool', {
              iteration, iterIdx, phaseName: 'debate', poolSize: pool.length,
            });
            iterStopReason = 'iteration_complete';
          } else {
            const { variantA, variantB } = dispatchResult;
            const debateExecOrder = ++executionOrder;
            const debateCtx: AgentContext = {
              db, runId, iteration,
              executionOrder: debateExecOrder,
              invocationId: '',
              randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `debate${debateExecOrder}`),
              logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
              experimentId: options?.experimentId,
              strategyId: options?.strategyId,
              rawProvider: llmProvider,
              defaultModel: resolvedConfig.generationModel,
              generationTemperature: resolvedConfig.generationTemperature,
            };
            const debateAgent = new DebateThenGenerateFromPreviousArticleAgent();
            try {
              const debateResult = await debateAgent.run({
                judgeModel: resolvedConfig.judgeModel,
                strategyDebateJudgeReasoningEffort: (resolvedConfig as { debateJudgeReasoningEffort?: 'none' | 'low' | 'medium' | 'high' }).debateJudgeReasoningEffort,
                iterDebateJudgeReasoningEffort: (iterCfg as { debateJudgeReasoningEffort?: 'none' | 'low' | 'medium' | 'high' }).debateJudgeReasoningEffort,
                variantA,
                variantB,
                initialPool: pool,
                initialRatings: ratings,
                initialMatchCounts: matchCounts,
                cache: comparisonCache,
                db,
              }, debateCtx);

              const debateOutput = debateResult.result;
              if (debateOutput && debateOutput.variant && debateOutput.surfaced) {
                // Single materialized variant per Decision §15. Merge ratings so
                // synthesis ranking matches reach global state before next iteration.
                const newVariants: Variant[] = [debateOutput.variant];
                iterVariantsCreated++;

                const debateMatchBuffers: MergeMatchEntry[][] = [];
                if (debateOutput.matches && debateOutput.matches.length > 0) {
                  debateMatchBuffers.push(
                    debateOutput.matches.map((m) => ({ match: m, idA: m.winnerId, idB: m.loserId })),
                  );
                }

                const mergeExecOrder = ++executionOrder;
                const mergeCtx: AgentContext = {
                  db, runId, iteration,
                  executionOrder: mergeExecOrder,
                  invocationId: '',
                  randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
                  logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
                  experimentId: options?.experimentId,
                  strategyId: options?.strategyId,
                };
                const mergeAgent = new MergeRatingsAgent();
                const mergeResult = await mergeAgent.run({
                  iterationType: 'debate_and_generate',
                  matchBuffers: debateMatchBuffers,
                  newVariants,
                  pool, ratings, matchCounts, matchHistory: allMatches,
                }, mergeCtx);

                if (mergeResult.budgetExceeded) iterStopReason = 'iteration_budget_exceeded';
              }

              if (debateResult.budgetExceeded) iterStopReason = 'iteration_budget_exceeded';
            } catch (err) {
              if (err instanceof IterationBudgetExceededError) {
                iterStopReason = 'iteration_budget_exceeded';
              } else {
                // DebateLLMError, DebateParseError, or unexpected — log + continue.
                // Partial-detail-on-throw inside DebateAgent has already persisted
                // forensic context onto the invocation row.
                logger.warn('Debate iteration failed — partial detail persisted, iteration continues', {
                  iteration, iterIdx, phaseName: 'debate',
                  error: err instanceof Error ? err.message : String(err),
                });
                iterStopReason = 'iteration_complete';
              }
            }
          }
        }

        const topKDebate = resolvedConfig.tournamentTopK ?? 5;
        const eloValues = topKEloValues(ratings, topKDebate);
        eloHistory.push(eloValues);
        uncertaintyHistory.push(topKUncertainties(ratings, topKDebate));

        iterationSnapshots.push(recordSnapshot(iteration, 'debate_and_generate', 'end', pool, ratings, matchCounts, {
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
        }));

        logger.info('Debate iteration complete', {
          iteration, iterIdx,
          variantsCreated: iterVariantsCreated,
          iterStopReason,
          budgetSpent: iterTracker.getTotalSpent(),
          topEloValues: eloValues.slice(0, 5),
          phaseName: 'debate',
        });

      } else if (iterType === 'swiss') {
        // ─── Swiss iteration ──────────────────────────────────
        // Loop SwissRankingAgent + MergeRatingsAgent until convergence, no pairs, or iteration budget.
        let swissRound = 0;
        const MAX_SWISS_ROUNDS = 10; // Safety cap within a single swiss iteration

        while (swissRound < MAX_SWISS_ROUNDS) {
          swissRound++;

          const eligibleIds = computeEligibleIds(pool, ratings);
          if (eligibleIds.length < 2) {
            iterStopReason = 'iteration_no_pairs';
            break;
          }
          if (allConverged(eligibleIds, ratings)) {
            iterStopReason = 'iteration_converged';
            break;
          }

          const candidatePairs = swissPairing(eligibleIds, ratings, completedPairs, MAX_PAIRS_PER_ROUND);
          if (candidatePairs.length === 0) {
            iterStopReason = 'iteration_no_pairs';
            break;
          }

          const swissExecOrder = ++executionOrder;
          const swissCtx: AgentContext = {
            db, runId, iteration,
            executionOrder: swissExecOrder,
            invocationId: '',
            randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `swiss${swissExecOrder}`),
            logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
            experimentId: options?.experimentId,
            strategyId: options?.strategyId,
            rawProvider: llmProvider,
            defaultModel: resolvedConfig.generationModel,
            generationTemperature: resolvedConfig.generationTemperature,
          };
          const swissAgent = new SwissRankingAgent();
          const swissResult = await swissAgent.run({
            eligibleIds,
            completedPairs,
            pool,
            ratings,
            cache: comparisonCache,
          }, swissCtx);

          const swissOutput = swissResult.result;
          if (!swissOutput || swissOutput.status === 'no_pairs') {
            iterStopReason = 'iteration_no_pairs';
            break;
          }

          // Merge unconditionally — paid-for matches must reach global ratings before budget exit.
          const mergeExecOrder = ++executionOrder;
          const mergeCtx: AgentContext = {
            db, runId, iteration,
            executionOrder: mergeExecOrder,
            invocationId: '',
            randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
            logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
            experimentId: options?.experimentId,
            strategyId: options?.strategyId,
          };
          const mergeAgent = new MergeRatingsAgent();
          const mergeBuffers: MergeMatchEntry[][] = [
            swissOutput.matches.map((m: SwissRankingMatchEntry) => ({ match: m.match, idA: m.idA, idB: m.idB })),
          ];
          const mergeResult = await mergeAgent.run({
            iterationType: 'swiss',
            matchBuffers: mergeBuffers,
            newVariants: [],
            pool, ratings, matchCounts, matchHistory: allMatches,
          }, mergeCtx);

          iterMatchesCompleted += swissOutput.matches.length;

          // Update completedPairs from this round's matches.
          for (const m of swissOutput.matches) {
            completedPairs.add(pairKey(m.idA, m.idB));
          }

          if (swissResult.budgetExceeded || mergeResult.budgetExceeded || swissOutput.status === 'budget') {
            iterStopReason = 'iteration_budget_exceeded';
            break;
          }
        }

        const topK = resolvedConfig.tournamentTopK ?? 5;
        const eloValues = topKEloValues(ratings, topK);
        eloHistory.push(eloValues);
        // B005-S1: keep uncertaintyHistory in lockstep with eloHistory.
        uncertaintyHistory.push(topKUncertainties(ratings, topK));

        iterationSnapshots.push(recordSnapshot(iteration, 'swiss', 'end', pool, ratings, matchCounts, {
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
        }));

        logger.info('Swiss iteration complete', {
          iteration, iterIdx,
          rounds: swissRound,
          matchesCompleted: iterMatchesCompleted,
          iterStopReason,
          budgetSpent: iterTracker.getTotalSpent(),
          topEloValues: eloValues.slice(0, 5),
          phaseName: 'ranking',
        });
      } else if (iterType === 'paragraph_recombine') {
        // ─── Paragraph-recombine iteration ───────────────
        // J4 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):
        // multi-dispatch refactor. Pre-J the branch ran EXACTLY 1 invocation per
        // iteration (single resolveParent → single agent.run), leaving most of the
        // iteration budget unspent. Post-J, when `iterCfg.maxDispatches > 1` AND
        // `sourceMode === 'pool'`, the loop picks up to K distinct parents from the
        // qualityCutoff-filtered eligible set and runs them in parallel + sequential
        // top-up, mirroring the `generate`-iteration RUNTIME pattern (no
        // `resolveParallelFloor` at runtime — only `resolveSequentialFloor` per the
        // generate convention at line ~718). The single MergeRatingsAgent at the
        // end consumes ALL K invocations' match histories via the multi-buffer shape.
        // `maxDispatches` defaults to 1 → exact backward-compat with single-dispatch.
        const paragraphEnabled = process.env.EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED !== 'false';
        if (!paragraphEnabled) {
          logger.info('Paragraph-recombine iteration skipped — EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED=false', {
            iteration, iterIdx, phaseName: 'paragraph_recombine',
          });
          iterStopReason = 'iteration_complete';
        } else {
          const iterSourceMode = iterCfg.sourceMode ?? 'seed';
          const inRunPool = pool.filter((v) => !v.fromArena);
          const poolForParentResolve = iterSourceMode === 'pool' ? inRunPool : pool;
          const maxDispatchesK = iterCfg.maxDispatches ?? 1;

          // Build the eligible-parent set ONCE (J4 step 1). For sourceMode='seed' or
          // when maxDispatchesK===1, we keep the existing single-resolveParent path
          // (back-compat — same RNG, same pick semantics). For maxDispatchesK>1 +
          // sourceMode='pool', we shuffle the eligible set and dispatch K distinct
          // parents indexed into the shuffle.
          type ResolvedParentRef = { variantId: string; text: string };
          const resolvedParents: ResolvedParentRef[] = [];

          if (maxDispatchesK > 1 && iterSourceMode === 'pool' && iterCfg.qualityCutoff) {
            // J4 step 1+2: filter by qualityCutoff then seeded pre-shuffle.
            const cutoff = iterCfg.qualityCutoff;
            const eloOf = (v: Variant): number => (ratings.get(v.id)?.elo ?? 0);
            const sorted = [...inRunPool].sort((a, b) => eloOf(b) - eloOf(a));
            let eligible: Variant[];
            if (cutoff.mode === 'topN') {
              eligible = sorted.slice(0, Math.max(1, cutoff.value));
            } else {
              const keepN = Math.max(1, Math.ceil(sorted.length * (cutoff.value / 100)));
              eligible = sorted.slice(0, keepN);
            }
            const shuffleSeed = deriveSeed(randomSeed, `iter${iteration}`, 'paragraph_recombine_shuffle');
            const shuffleRng = new SeededRandom(shuffleSeed);
            shuffleRng.shuffle(eligible); // in-place
            for (const v of eligible) resolvedParents.push({ variantId: v.id, text: v.text });
          } else {
            // Back-compat single-dispatch path.
            const singleExecOrder = ++executionOrder;
            const pickRng = createSeededRng(hashSeed(runId, iteration, singleExecOrder));
            const resolved = resolveParent({
              sourceMode: iterSourceMode,
              qualityCutoff: iterCfg.qualityCutoff,
              seedVariant: { id: options?.seedVariantId ?? '', text: originalText },
              pool: poolForParentResolve,
              ratings,
              rng: pickRng,
              warn: (msg, c) => logger.warn(msg, { ...c, phaseName: 'paragraph_recombine', iteration, execOrder: singleExecOrder }),
            });
            executionOrder--; // give it back; we'll re-allocate in the dispatch loop below
            resolvedParents.push({ variantId: resolved.variantId, text: resolved.text });
          }

          // J4 step 3: parallel batch sizing using projector.expected as the per-agent
          // cost estimate. Mirror the generate-runtime pattern (no `resolveParallelFloor`
          // at runtime — only `resolveSequentialFloor` later for top-up gating).
          // For K=1 (back-compat), this collapses to the same single-dispatch behavior.
          const projector = estimateParagraphRecombineCost(
            originalText.length, // best estimate when each parent has comparable length
            iterCfg.maxParagraphsPerInvocation ?? 12,
            iterCfg.rewritesPerParagraph ?? 3,
            iterCfg.maxComparisonsPerParagraph ?? 8,
            iterCfg.paragraphRewriteModel ?? resolvedConfig.generationModel,
            resolvedConfig.judgeModel,
          );
          const expectedPerAgent = Math.max(0.001, projector.expected);
          const availForParallel = iterTracker.getAvailableBudget();
          const maxAffordable = Math.max(1, Math.floor(availForParallel / expectedPerAgent));
          const parallelDispatchCount = Math.min(
            DISPATCH_SAFETY_CAP,
            maxAffordable,
            maxDispatchesK,
            resolvedParents.length,
          );

          const makePrCtx = (execOrder: number): AgentContext => ({
            db, runId, iteration,
            executionOrder: execOrder,
            invocationId: '',
            randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `paragraph_recombine${execOrder}`),
            logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
            experimentId: options?.experimentId,
            strategyId: options?.strategyId,
            rawProvider: llmProvider,
            defaultModel: resolvedConfig.generationModel,
            generationTemperature: resolvedConfig.generationTemperature,
          });

          const surfacedVariants: Variant[] = [];
          const matchBuffersAll: MergeMatchEntry[][] = [];
          let topupBudgetExceeded = false;

          try {
            // J4 step 3: Parallel batch dispatch. Capture iteration-tracker spend
            // before/after to compute `actualAvgCostPerAgent` for the sequential top-up
            // floor calc (mirrors the generate-runtime convention).
            const spendBeforeParallel = iterTracker.getTotalSpent();
            const parallelParents = resolvedParents.slice(0, parallelDispatchCount);
            const parallelResults = await Promise.allSettled(
              parallelParents.map((parent) => {
                const execOrder = ++executionOrder;
                const paragraphAgent = new ParagraphRecombineAgent();
                return paragraphAgent.run({
                  parentText: parent.text,
                  parentVariantId: parent.variantId,
                  rewritesPerParagraph: iterCfg.rewritesPerParagraph,
                  maxComparisonsPerParagraph: iterCfg.maxComparisonsPerParagraph,
                  maxParagraphsPerInvocation: iterCfg.maxParagraphsPerInvocation,
                  perInvocationCapUsd: iterCfg.perInvocationCapUsd,
                  initialPool: pool,
                  initialRatings: ratings,
                  initialMatchCounts: matchCounts,
                  cache: comparisonCache,
                }, makePrCtx(execOrder));
              }),
            );

            let successCount = 0;
            for (const settled of parallelResults) {
              if (settled.status !== 'fulfilled') continue;
              const prResult = settled.value;
              if (prResult.budgetExceeded) iterStopReason = 'iteration_budget_exceeded';
              const prOutput = prResult.result;
              if (!prOutput) continue;
              successCount++;
              if (prOutput.variant && prOutput.surfaced) {
                surfacedVariants.push(prOutput.variant);
                iterVariantsCreated++;
                if (prOutput.matches && prOutput.matches.length > 0) {
                  matchBuffersAll.push(
                    prOutput.matches.map((m) => ({ match: m, idA: m.winnerId, idB: m.loserId })),
                  );
                }
              }
            }

            const spendAfterParallel = iterTracker.getTotalSpent();
            const actualAvgCostPerAgent = successCount > 0
              ? (spendAfterParallel - spendBeforeParallel) / successCount
              : null;

            // J4 step 5: Sequential top-up. Only fires when there are remaining
            // parents to dispatch + EVOLUTION_TOPUP_ENABLED isn't disabled + we
            // haven't already hit the iteration budget. Gate via resolveSequentialFloor
            // (matches runIterationLoop.ts:718 generate convention).
            const topUpEnabled = process.env.EVOLUTION_TOPUP_ENABLED !== 'false';
            if (
              topUpEnabled &&
              iterStopReason !== 'iteration_budget_exceeded' &&
              parallelDispatchCount < maxDispatchesK &&
              parallelDispatchCount < resolvedParents.length
            ) {
              // J3 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):
              // per-iteration floor overrides take precedence over strategy-level
              // fields. Build a synthetic `BudgetFloorConfig` that prefers iter-level
              // values when set; falls back to strategy-level otherwise. Fraction
              // wins over AgentMultiple within a single config (resolver convention).
              const iterFloorConfig = {
                minBudgetAfterSequentialFraction: iterCfg.sequentialFloorFraction
                  ?? resolvedConfig.minBudgetAfterSequentialFraction,
                minBudgetAfterSequentialAgentMultiple: iterCfg.sequentialFloorAgentMultiple
                  ?? resolvedConfig.minBudgetAfterSequentialAgentMultiple,
                // Parallel floor fields are unused at runtime here (only resolveSequentialFloor
                // is consulted at runtime per generate convention), but pass them through
                // for completeness in case the resolver ever consults them.
                minBudgetAfterParallelFraction: iterCfg.parallelFloorFraction
                  ?? resolvedConfig.minBudgetAfterParallelFraction,
                minBudgetAfterParallelAgentMultiple: iterCfg.parallelFloorAgentMultiple
                  ?? resolvedConfig.minBudgetAfterParallelAgentMultiple,
              };
              const sequentialFloor = resolveSequentialFloor(
                iterFloorConfig,
                iterBudgetUsd,
                expectedPerAgent,
                actualAvgCostPerAgent,
              );
              let topUpIndex = parallelDispatchCount;
              while (
                topUpIndex < resolvedParents.length &&
                topUpIndex < maxDispatchesK &&
                topUpIndex < DISPATCH_SAFETY_CAP
              ) {
                const avgCostForFloor = actualAvgCostPerAgent ?? expectedPerAgent;
                if (iterTracker.getAvailableBudget() - avgCostForFloor < sequentialFloor) break;
                const parent = resolvedParents[topUpIndex]!;
                const execOrder = ++executionOrder;
                const paragraphAgent = new ParagraphRecombineAgent();
                try {
                  const prResult = await paragraphAgent.run({
                    parentText: parent.text,
                    parentVariantId: parent.variantId,
                    rewritesPerParagraph: iterCfg.rewritesPerParagraph,
                    maxComparisonsPerParagraph: iterCfg.maxComparisonsPerParagraph,
                    maxParagraphsPerInvocation: iterCfg.maxParagraphsPerInvocation,
                    perInvocationCapUsd: iterCfg.perInvocationCapUsd,
                    initialPool: pool,
                    initialRatings: ratings,
                    initialMatchCounts: matchCounts,
                    cache: comparisonCache,
                  }, makePrCtx(execOrder));
                  if (prResult.budgetExceeded) {
                    topupBudgetExceeded = true;
                    iterStopReason = 'iteration_budget_exceeded';
                    break;
                  }
                  const prOutput = prResult.result;
                  if (prOutput?.variant && prOutput.surfaced) {
                    surfacedVariants.push(prOutput.variant);
                    iterVariantsCreated++;
                    if (prOutput.matches && prOutput.matches.length > 0) {
                      matchBuffersAll.push(
                        prOutput.matches.map((m) => ({ match: m, idA: m.winnerId, idB: m.loserId })),
                      );
                    }
                  }
                } catch (err) {
                  if (err instanceof IterationBudgetExceededError) {
                    topupBudgetExceeded = true;
                    iterStopReason = 'iteration_budget_exceeded';
                    break;
                  }
                  // Single-invocation failure during top-up is non-fatal; continue with next.
                  logger.warn('Paragraph-recombine top-up invocation failed', {
                    iteration, iterIdx, phaseName: 'paragraph_recombine',
                    parentVariantId: parent.variantId,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
                topUpIndex++;
              }
            }

            // J4 step 6: Single MergeRatingsAgent over ALL surfaced variants' match buffers.
            if (surfacedVariants.length > 0) {
              const mergeExecOrder = ++executionOrder;
              const mergeCtx: AgentContext = {
                db, runId, iteration,
                executionOrder: mergeExecOrder,
                invocationId: '',
                randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `merge${mergeExecOrder}`),
                logger, costTracker: iterTracker, config: resolvedConfig, promptId: options?.promptId ?? null,
                experimentId: options?.experimentId,
                strategyId: options?.strategyId,
              };
              const mergeAgent = new MergeRatingsAgent();
              const mergeResult = await mergeAgent.run({
                iterationType: 'paragraph_recombine',
                matchBuffers: matchBuffersAll,
                newVariants: surfacedVariants,
                pool, ratings, matchCounts, matchHistory: allMatches,
              }, mergeCtx);
              if (mergeResult.budgetExceeded) iterStopReason = 'iteration_budget_exceeded';
            }
            // Avoid unused-var warning when no top-up failure surfaces.
            void topupBudgetExceeded;
          } catch (err) {
            if (err instanceof IterationBudgetExceededError) {
              iterStopReason = 'iteration_budget_exceeded';
            } else {
              logger.warn('Paragraph-recombine iteration failed — partial detail persisted, iteration continues', {
                iteration, iterIdx, phaseName: 'paragraph_recombine',
                error: err instanceof Error ? err.message : String(err),
              });
              iterStopReason = 'iteration_complete';
            }
          }
        }

        const topKPR = resolvedConfig.tournamentTopK ?? 5;
        const eloValues = topKEloValues(ratings, topKPR);
        eloHistory.push(eloValues);
        uncertaintyHistory.push(topKUncertainties(ratings, topKPR));

        iterationSnapshots.push(recordSnapshot(iteration, 'paragraph_recombine', 'end', pool, ratings, matchCounts, {
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
        }));

        logger.info('Paragraph-recombine iteration complete', {
          iteration, iterIdx,
          variantsCreated: iterVariantsCreated,
          iterStopReason,
          budgetSpent: iterTracker.getTotalSpent(),
          topEloValues: eloValues.slice(0, 5),
          phaseName: 'paragraph_recombine',
        });
      }
    } catch (err) {
      // Run-level BudgetExceededError stops the entire run.
      if (err instanceof BudgetExceededError && !(err instanceof IterationBudgetExceededError)) {
        logger.warn('Run-level budget exceeded', { iteration, iterIdx, phaseName: 'loop', error: err.message });
        stopReason = 'total_budget_exceeded';

        // Record partial iteration result.
        iterStopReason = 'iteration_budget_exceeded';
        iterationResults.push({
          iteration,
          agentType: iterType,
          stopReason: iterStopReason,
          budgetAllocated: iterBudgetUsd,
          budgetSpent: iterTracker.getTotalSpent(),
          variantsCreated: iterVariantsCreated,
          matchesCompleted: iterMatchesCompleted,
        });
        break;
      }
      throw err; // Re-throw unexpected errors.
    }

    // Record iteration result.
    iterationResults.push({
      iteration,
      agentType: iterType,
      stopReason: iterStopReason,
      budgetAllocated: iterBudgetUsd,
      budgetSpent: iterTracker.getTotalSpent(),
      variantsCreated: iterVariantsCreated,
      matchesCompleted: iterMatchesCompleted,
    });
  }

  // ─── Winner determination ──────────────────────────────────
  // Pool may be empty when seed generation failed before any variants were added.
  // finalizeRun handles empty pool by marking the run failed.
  let winner: Variant | undefined;
  if (pool.length > 0) {
    const winResult = selectWinner(pool, ratings);
    winner = pool.find((v) => v.id === winResult.winnerId) ?? pool[0];
    logger.info('Winner determined', { winnerId: winner?.id, winnerElo: winResult.elo, winnerUncertainty: winResult.uncertainty, phaseName: 'winner_determination' });
  }

  logger.info('Evolution complete', {
    stopReason, iterations: iteration, poolSize: pool.length,
    totalCost: costTracker.getTotalSpent(), winnerId: winner?.id,
    phaseName: 'evolution_complete',
  });

  return {
    winner: winner!,
    pool,
    ratings,
    matchHistory: allMatches,
    totalCost: costTracker.getTotalSpent(),
    iterationsRun: iteration,
    stopReason,
    iterationResults,
    eloHistory,
    uncertaintyHistory,
    diversityHistory,
    matchCounts: Object.fromEntries(matchCounts),
    discardedVariants,
    discardedLocalRatings,
    iterationSnapshots,
    randomSeed,
    isSeeded: options?.seedVariantId ? true : undefined,
    budgetFloorObservables: {
      initialAgentCostEstimate,
      actualAvgCostPerAgent,
      parallelDispatched: parallelDispatchedCount,
      sequentialDispatched: sequentialDispatchedCount,
    },
    budgetFloorConfig: {
      minBudgetAfterParallelFraction: resolvedConfig.minBudgetAfterParallelFraction,
      minBudgetAfterParallelAgentMultiple: resolvedConfig.minBudgetAfterParallelAgentMultiple,
      minBudgetAfterSequentialFraction: resolvedConfig.minBudgetAfterSequentialFraction,
      minBudgetAfterSequentialAgentMultiple: resolvedConfig.minBudgetAfterSequentialAgentMultiple,
    },
  };
}
