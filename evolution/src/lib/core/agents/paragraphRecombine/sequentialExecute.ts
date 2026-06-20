// Sequential Context-Aware Generation orchestrator for paragraph_recombine
// (debug_performance_paragraph_recombine_20260612). Runs after Phase A coordinator
// returns the per-paragraph plan; performs the sequential loop where each paragraph's
// M variations are generated in parallel BUT every variation sees the prior-picks
// list as PRIOR CONTEXT. After the loop, returns slot details + winners + counters
// for the caller to assemble + emit.

import type { AgentContext } from '../../types';
import type { EvolutionLLMClient } from '../../../types';
import { type Variant } from '../../../types';
import type { SlotRecombineExecutionDetail, CoordinatorPlan } from '../../../schemas';
import type { AgentCostScope } from '../../../pipeline/infra/trackBudget';
import { createAgentCostScope } from '../../../pipeline/infra/trackBudget';
import { createEvolutionLLMClient } from '../../../pipeline/infra/createEvolutionLLMClient';
import { validateParagraphRewrite } from '../../../shared/paragraphSlots';
import { rankNewVariant } from '../../../pipeline/loop/rankNewVariant';
import { loadArenaEntries } from '../../../pipeline/setup/buildRunContext';
import { selectWinner, type WinnerCandidate } from '../../../shared/selectWinner';
import { createRating, type Rating, type ComparisonResult } from '../../../shared/computeRatings';
import { syncToArena } from '../../../pipeline/finalize/persistRunResults';
import {
  upsertSlotTopic,
  persistSlotMatches,
  makeMatchKey,
  type BeforeAfterRatingsMap,
} from '../../../../services/slotTopicActions';
import { buildSequentialRewritePrompt } from './buildSequentialRewritePrompt';
import { sanitizeForPriorContext, containsDelimiterMirror } from './promptSafety';
import { estimateParagraphRecombineCost } from '../../../pipeline/infra/estimateCosts';
import { runCoordinator, CoordinatorLLMError, CoordinatorParseError } from './coordinator';

/** Phase 2 (Fix 2): projected cost of one mid-sequence replan coordinator call.
 *  Used by the budget-floor gate to skip replan when we can't afford it. */
export const PROJECTED_REPLAN_COST_USD = 0.0014;

/** Phase 2 (Fix 2): minimum per-invocation cap below which replan is skipped even
 *  when the env flag is on. Derived from the existing low-cap threshold + the
 *  projected replan cost with a 10× safety margin to avoid pushing the next slot
 *  into budget-exhausted fallback. */
export const REPLAN_MIN_CAP_USD = 0.030;

export type SequentialCounters = {
  parentFallbackCount: number;
  skippedSlotCount: number;
  rewrittenSlotCount: number;
  priorPicksSanitizationCount: number;
  priorPicksTruncationCount: number;
  /** investigate_sequential_paragraph_recombine_performance_20260615 Phase 1c-i:
   *  counters for the new forward-context (nextContext) path. Mirror the priorPicks*
   *  counters so the admin slot-leaderboard surfaces them in the same panel.
   *
   *  Phase 4e.A1: the rewriter now ALSO consumes nextContext (previously judge-only).
   *  Both consumers read the same already-sanitized array — sanitization happens
   *  once at the array-construction site in runSequentialLoop (line ~198), so
   *  `nextPicksSanitizationCount` covers both judge AND rewriter consumption.
   *  No separate `nextContextRewriterSanitizationCount` is added — adding one
   *  would either duplicate the existing counter or require a separate
   *  per-consumer sanitization pass (which the architecture deliberately avoids). */
  nextPicksSanitizationCount: number;
  nextPicksTruncationCount: number;
  /** investigate_sequential_paragraph_recombine_performance_20260615 Phase 2 (Fix 2):
   *  Replan counters. Currently 0 or 1 per invocation (replan fires once after slot 0
   *  succeeds); the .max(1) cap may grow to N in a future "replan every K slots"
   *  iteration. replanSkippedReason is set when replan was eligible but skipped — the
   *  remaining 5 reasons cover legitimate skip conditions (single-slot articles, budget
   *  exhaustion, slot-0 failures or seed-wins where replan can't anchor on a winner,
   *  and the budget-floor gate that protects against pushing the next slot into
   *  fallback). The 'disabled' reason was removed when the env flag was retired and
   *  replan became unconditional. */
  replanCount: number;
  replanFailureCount: number;
  replanSkippedCount: number;
  replanSkippedReason?: 'single_slot' | 'budget_exhausted' |
    'slot0_all_failed' | 'slot0_parent_won' | 'budget_floor';
};

export type SequentialLoopResult = {
  slotDetails: SlotRecombineExecutionDetail['slots'];
  slotWinnerTexts: Map<number, string>;
  priorPicks: string[];
  counters: SequentialCounters;
  /** When the per-round budget gate fires mid-loop, set to the paragraph index at
   *  which generation stopped. Slots from this index onward are recorded with
   *  `discardReason.failurePoint = 'budget_exhausted'` (mapped to slot_budget enum). */
  budgetExhaustedAt?: number;
  /** Phase 2 (Fix 2): the post-replan merged coordinator plan when replan ran AND
   *  succeeded. The agent persists this as execution_detail.coordinatorPlanReplanned
   *  alongside the original (pre-replan) plan in execution_detail.coordinatorPlan. */
  mergedCoordinatorPlan?: CoordinatorPlan;
};

export type SequentialLoopParams = {
  slots: ReadonlyArray<{ paragraphIndex: number; originalText: string; }>;
  paragraphCount: number;
  parentVariantId: string;
  coordinatorPlan: CoordinatorPlan;
  perInvocationCapUsd: number;
  rewriteModel: string;
  judgeModel: string;
  invocationScope: AgentCostScope;
  ctx: AgentContext;
  llm: EvolutionLLMClient;
  /** Phase 2 (Fix 2): parent article text passed to the replan coordinator. Required —
   *  the orchestrator hands the original parent text to the agent, which forwards it
   *  here. The replan call needs both this AND the model. */
  parentText: string;
  /** Phase 2: model used for the replan call. Same model as the initial coordinator
   *  unless 4d's coordinatorModelForReplan override is set. */
  generationModelForReplan: string;
  /** Phase 4d: optional coordinator-model override for the replan call. When set,
   *  takes precedence over generationModelForReplan. The agent reads the value off
   *  ctx.config (mirrors editingModel/approverModel pattern) and threads it through
   *  here so both the initial-plan and mid-sequence replan honor the same override —
   *  without this, the replan would silently keep using the rewrite model while only
   *  the initial plan respected the strategy's coordinatorModel. */
  coordinatorModelForReplan?: string;
};

export async function runSequentialLoop(params: SequentialLoopParams): Promise<SequentialLoopResult> {
  const {
    slots, paragraphCount, parentVariantId,
    perInvocationCapUsd, rewriteModel, judgeModel,
    invocationScope, ctx, llm,
    parentText, generationModelForReplan, coordinatorModelForReplan,
  } = params;
  // Phase 4d: prefer the explicit replan override; fall back to the existing
  // generationModelForReplan param so pre-Phase-4d call sites are byte-identical.
  const effectiveReplanModel = coordinatorModelForReplan ?? generationModelForReplan;
  // coordinatorPlan is `let` so we can mutate-by-rebind after a successful replan
  // (immutability invariant preserved — we never mutate the original plan in place).
  let { coordinatorPlan } = params;
  let mergedCoordinatorPlan: CoordinatorPlan | undefined;

  const slotDetails: SlotRecombineExecutionDetail['slots'] = [];
  const slotWinnerTexts = new Map<number, string>();
  const priorPicks: string[] = [];
  const counters: SequentialCounters = {
    parentFallbackCount: 0,
    skippedSlotCount: 0,
    rewrittenSlotCount: 0,
    priorPicksSanitizationCount: 0,
    priorPicksTruncationCount: 0,
    nextPicksSanitizationCount: 0,
    nextPicksTruncationCount: 0,
    replanCount: 0,
    replanFailureCount: 0,
    replanSkippedCount: 0,
  };

  // Per-round amortized cost projection (used by the budget gate). Re-computed once.
  const projection = estimateParagraphRecombineCost(
    /* parentArticleChars */ slots.reduce((s, sl) => s + sl.originalText.length, 0),
    paragraphCount,
    /* rewritesPerParagraph */ Math.max(1, Math.round(
      coordinatorPlan.paragraphPlans.reduce((s, p) => s + p.M, 0) / Math.max(1, paragraphCount),
    )),
    /* maxComparisonsPerParagraph */ 8,
    rewriteModel,
    judgeModel,
    { sequentialEnabled: true },
  );
  const projectedPerRound = paragraphCount > 0
    ? projection.perPhase.paragraphRewriteCost / paragraphCount
    : 0;

  let budgetExhaustedAt: number | undefined;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    const paragraphPlan = coordinatorPlan.paragraphPlans.find(
      (p) => p.paragraphIndex === slot.paragraphIndex,
    );

    // 1. Skip-if-shouldRewrite-false: push parent paragraph onto priorPicks.
    if (paragraphPlan && !paragraphPlan.shouldRewrite) {
      pushSanitized(slot.originalText, priorPicks, counters);
      slotWinnerTexts.set(slot.paragraphIndex, slot.originalText);
      slotDetails.push(makeSkippedSlotDetail(slot));
      counters.skippedSlotCount++;
      continue;
    }

    // 2. Per-round budget gate.
    const budgetRemaining = perInvocationCapUsd - invocationScope.getOwnSpent!();
    const paragraphsRemaining = paragraphCount - i;
    if (budgetRemaining < projectedPerRound * paragraphsRemaining * 2.0) {
      // Budget exhausted — push parent for ALL remaining slots, mark, break.
      budgetExhaustedAt = i;
      for (let k = i; k < slots.length; k++) {
        const remaining = slots[k]!;
        pushSanitized(remaining.originalText, priorPicks, counters);
        slotWinnerTexts.set(remaining.paragraphIndex, remaining.originalText);
        slotDetails.push(makeBudgetExhaustedSlotDetail(remaining));
        counters.parentFallbackCount++;
      }
      break;
    }

    // Phase 1c-i — compute forward parent context for the slot judge. Sanitize each
    // entry the same way priorPicks are sanitized (delimiter-tag redaction); the
    // builder does NOT re-sanitize. Counter increment mirrors the priorPicks path.
    const nextContext: string[] = [];
    for (let j = i + 1; j < slots.length; j++) {
      const remaining = slots[j]!;
      const { sanitized, redacted } = sanitizeForPriorContext(remaining.originalText);
      if (redacted) counters.nextPicksSanitizationCount++;
      nextContext.push(sanitized);
    }

    // 3-9. Process the round: generate M variations + judge + pick winner.
    const result = await processSequentialRound({
      slot,
      paragraphPlan,
      paragraphCount,
      priorPicks,
      nextContext,
      parentVariantId,
      perInvocationCapUsd,
      invocationScope,
      ctx,
      llm,
    });

    slotDetails.push(result.slotDetail);
    const finalText = result.winnerText;
    slotWinnerTexts.set(slot.paragraphIndex, finalText);
    pushSanitized(finalText, priorPicks, counters);

    if (result.winnerIsOriginal || result.allRewritesFailed) {
      counters.parentFallbackCount++;
    } else {
      counters.rewrittenSlotCount++;
    }

    // ─── Phase 2 (Fix 2): mid-sequence coordinator replan ─────────
    // Fires UNCONDITIONALLY after slot 0 finalizes (i === 0) when ALL of the
    // success-predicate conditions hold. Iter-1 architecture review pinned the
    // predicate explicitly here; see planning doc Phase 2c. The call is wrapped in
    // a try/catch so neither CoordinatorLLMError nor CoordinatorParseError can
    // propagate to the agent's Phase B catch (which would discard slot 0's work
    // and trigger partial-detail-on-throw).
    if (i === 0) {
      if (slots.length <= 1) {
        counters.replanSkippedCount = 1;
        counters.replanSkippedReason = 'single_slot';
      } else if (budgetExhaustedAt !== undefined) {
        counters.replanSkippedCount = 1;
        counters.replanSkippedReason = 'budget_exhausted';
      } else if (result.allRewritesFailed) {
        counters.replanSkippedCount = 1;
        counters.replanSkippedReason = 'slot0_all_failed';
      } else if (result.winnerIsOriginal) {
        counters.replanSkippedCount = 1;
        counters.replanSkippedReason = 'slot0_parent_won';
      } else if (
        perInvocationCapUsd < REPLAN_MIN_CAP_USD
        || (perInvocationCapUsd - invocationScope.getOwnSpent!()) < PROJECTED_REPLAN_COST_USD * 2.0
      ) {
        counters.replanSkippedCount = 1;
        counters.replanSkippedReason = 'budget_floor';
      } else {
        try {
          const replanResult = await runCoordinator({
            parentText,
            paragraphCount,
            llm,
            // Phase 4d: honor the coordinatorModel override on the replan path too.
            generationModel: effectiveReplanModel,
            ...(ctx.invocationId !== '' && { invocationId: ctx.invocationId }),
            priorPicks,
            firstSlot: 1,
          });
          // paragraphIndex-keyed merge: keep coordinatorPlan entries for index 0
          // (slot 0's plan) and slots whose replan output didn't cover them; replace
          // every entry whose paragraphIndex is covered by the replan plan.
          const replanByIndex = new Map<number, CoordinatorPlan['paragraphPlans'][number]>();
          for (const entry of replanResult.plan.paragraphPlans) {
            replanByIndex.set(entry.paragraphIndex, entry);
          }
          const mergedPlans = coordinatorPlan.paragraphPlans.map((entry) =>
            replanByIndex.get(entry.paragraphIndex) ?? entry,
          );
          // Build a NEW plan reference (do not mutate the original).
          mergedCoordinatorPlan = { ...coordinatorPlan, paragraphPlans: mergedPlans };
          coordinatorPlan = mergedCoordinatorPlan;
          counters.replanCount = 1;
        } catch (err) {
          // BOTH CoordinatorLLMError AND CoordinatorParseError land here — do NOT
          // re-throw. The slot 0 work is preserved; loop continues with the
          // original plan. Log enough detail for postmortem.
          counters.replanFailureCount = 1;
          const isParse = err instanceof CoordinatorParseError;
          const isLLM = err instanceof CoordinatorLLMError;
          ctx.logger.warn?.('paragraph_recombine: replan failed, falling back to original plan', {
            errorKind: isParse ? 'parse' : isLLM ? 'llm' : 'unknown',
            error: err instanceof Error ? err.message : String(err),
            ...(isParse && { parseError: (err as CoordinatorParseError).parseError }),
          });
        }
      }
    }
  }

  const result: SequentialLoopResult = {
    slotDetails,
    slotWinnerTexts,
    priorPicks,
    counters,
  };
  if (budgetExhaustedAt !== undefined) {
    result.budgetExhaustedAt = budgetExhaustedAt;
  }
  if (mergedCoordinatorPlan !== undefined) {
    result.mergedCoordinatorPlan = mergedCoordinatorPlan;
  }
  return result;
}

function pushSanitized(text: string, priorPicks: string[], counters: SequentialCounters): void {
  const { sanitized, redacted } = sanitizeForPriorContext(text);
  if (redacted) counters.priorPicksSanitizationCount++;
  priorPicks.push(sanitized);
}

function makeSkippedSlotDetail(
  slot: { paragraphIndex: number; originalText: string; },
): SlotRecombineExecutionDetail['slots'][number] {
  return {
    slotIndex: slot.paragraphIndex,
    originalText: slot.originalText,
    originalSlotVariantId: '00000000-0000-0000-0000-000000000000',
    slotTopicId: '00000000-0000-0000-0000-000000000000',
    perSlotBudgetUsd: 0,
    spentUsd: 0,
    rewrites: [],
    discardReason: { failurePoint: 'no_valid_rewrites', message: 'coordinator marked shouldRewrite=false' },
  };
}

function makeBudgetExhaustedSlotDetail(
  slot: { paragraphIndex: number; originalText: string; },
): SlotRecombineExecutionDetail['slots'][number] {
  return {
    slotIndex: slot.paragraphIndex,
    originalText: slot.originalText,
    originalSlotVariantId: '00000000-0000-0000-0000-000000000000',
    slotTopicId: '00000000-0000-0000-0000-000000000000',
    perSlotBudgetUsd: 0,
    spentUsd: 0,
    rewrites: [],
    discardReason: { failurePoint: 'slot_budget', message: 'budget_exhausted: per-round gate fired before generation' },
  };
}

type ProcessSequentialRoundParams = {
  slot: { paragraphIndex: number; originalText: string; };
  paragraphPlan: CoordinatorPlan['paragraphPlans'][number] | undefined;
  paragraphCount: number;
  priorPicks: readonly string[];
  /** Phase 1c-i (Fix 4): forward parent context (sanitized) for the slot judge. */
  nextContext: readonly string[];
  parentVariantId: string;
  perInvocationCapUsd: number;
  invocationScope: AgentCostScope;
  ctx: AgentContext;
  llm: EvolutionLLMClient;
};

type ProcessSequentialRoundResult = {
  slotDetail: SlotRecombineExecutionDetail['slots'][number];
  winnerText: string;
  winnerIsOriginal: boolean;
  allRewritesFailed: boolean;
};

async function processSequentialRound(
  params: ProcessSequentialRoundParams,
): Promise<ProcessSequentialRoundResult> {
  const {
    slot, paragraphPlan, paragraphCount, priorPicks, nextContext, parentVariantId,
    perInvocationCapUsd, invocationScope, ctx, llm,
  } = params;

  // Per-slot AgentCostScope (D16) — sequential dispatch still benefits from per-slot
  // isolation for cost accounting + self-abort.
  const slotScope = createAgentCostScope(invocationScope);
  const perSlotBudgetUsd = paragraphCount > 0 ? perInvocationCapUsd / paragraphCount : 0;
  const localPool: Variant[] = [];
  const localRatings = new Map<string, Rating>();
  const localMatchCounts = new Map<string, number>();
  const completedPairs = new Set<string>();
  const cache = new Map<string, ComparisonResult>();
  const beforeAfterRatings: BeforeAfterRatingsMap = new Map();

  const slotLogger = ctx.logger.child?.(['slot', String(slot.paragraphIndex)]) ?? ctx.logger;

  const slotLlm = ctx.rawProvider && ctx.defaultModel
    ? createEvolutionLLMClient(
        ctx.rawProvider, slotScope, ctx.defaultModel,
        slotLogger,
        ctx.db, ctx.runId,
        undefined,
        ctx.invocationId === '' ? undefined : ctx.invocationId,
      )
    : llm;

  // ─── Topic setup (D10) ───────────────────────────────────────────
  let topicId: string;
  let originalSlotVariantId: string;
  try {
    const upsert = await upsertSlotTopic(ctx.db, 'paragraph', parentVariantId, slot.paragraphIndex, slot.originalText);
    topicId = upsert.topicId;
    originalSlotVariantId = upsert.originalSlotVariantId;
  } catch (err) {
    slotLogger.warn?.('paragraph_recombine: slot discarded', {
      slotIndex: slot.paragraphIndex,
      failurePoint: 'sync_failed',
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      slotDetail: {
        slotIndex: slot.paragraphIndex,
        originalText: slot.originalText,
        originalSlotVariantId: '00000000-0000-0000-0000-000000000000',
        slotTopicId: '00000000-0000-0000-0000-000000000000',
        perSlotBudgetUsd,
        spentUsd: slotScope.getOwnSpent!(),
        rewrites: [],
        discardReason: { failurePoint: 'sync_failed', message: err instanceof Error ? err.message : String(err) },
      },
      winnerText: slot.originalText,
      winnerIsOriginal: true,
      allRewritesFailed: true,
    };
  }

  // Seed the slot's local pool with the original-paragraph variant.
  const originalAsVariant: Variant = {
    id: originalSlotVariantId,
    text: slot.originalText,
    tactic: 'paragraph_original',
    version: 0,
    parentIds: [],
    createdAt: Date.now() / 1000,
    iterationBorn: 0,
  };
  localPool.push(originalAsVariant);
  localRatings.set(originalSlotVariantId, createRating());

  try {
    const arena = await loadArenaEntries(topicId, ctx.db, undefined, {
      topK: 20,
      alwaysIncludeIds: [originalSlotVariantId],
    });
    for (const v of arena.variants) {
      if (v.id === originalSlotVariantId) continue;
      localPool.push(v);
      const rating = arena.ratings.get(v.id);
      if (rating) localRatings.set(v.id, rating);
    }
  } catch {
    /* non-fatal */
  }

  // ─── Generate M variations in PARALLEL using coordinator directives ──
  const M = paragraphPlan?.M ?? 3;
  const candidates = paragraphPlan?.candidates ?? [];
  const rewriteResults = await Promise.allSettled(
    Array.from({ length: M }, async (_, index) => {
      const cand = candidates[index];
      const directive = cand?.directive
        ?? 'Tighten this paragraph while preserving its key facts and overall meaning.';
      const temperature = cand?.temperature;
      const { prompt } = buildSequentialRewritePrompt({
        paragraphIndex: slot.paragraphIndex,
        totalParagraphs: paragraphCount,
        parentParagraph: slot.originalText,
        priorPicks,
        // Phase 4e.A1: thread the same nextContext array the judge sees into the
        // rewriter. Already sanitized at the boundary where it was computed (per
        // Phase 1c-i: each entry runs through sanitizeForPriorContext before
        // being added to the array).
        nextContext,
        coordinatorDirective: directive,
      });

      if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION_LOCAL * perSlotBudgetUsd) {
        return { index, skipped: true as const, temperature };
      }

      const tStart = Date.now();
      const phasesBefore = slotScope.getPhaseCosts();
      const rewriteBefore = phasesBefore['paragraph_rewrite'] ?? 0;
      let text: string;
      try {
        text = await slotLlm.complete(
          prompt, 'paragraph_rewrite',
          temperature !== undefined ? { temperature } : undefined,
        );
      } catch (err) {
        return { index, skipped: false as const, error: err instanceof Error ? err.message : String(err), temperature };
      }
      const phasesAfter = slotScope.getPhaseCosts();
      const rewriteAfter = phasesAfter['paragraph_rewrite'] ?? 0;
      const costUsd = Math.max(0, rewriteAfter - rewriteBefore);
      const durationMs = Date.now() - tStart;

      // Reject candidates whose output mirrors a delimiter tag (B.11 post-generation guard).
      if (containsDelimiterMirror(text)) {
        return {
          index,
          skipped: false as const,
          text,
          costUsd,
          durationMs,
          validation: { valid: false, dropReason: 'no_h1' as const }, // generic format-violation bucket
          temperature,
          delimiterMirrored: true,
        };
      }

      const validation = validateParagraphRewrite(text, slot.originalText.length);
      return { index, skipped: false as const, text, costUsd, durationMs, validation, temperature };
    }),
  );

  // ─── Collect surviving rewrites ──────────────────────────────────
  const rewrites: SlotRecombineExecutionDetail['slots'][number]['rewrites'] = [];
  const survivingRewriteVariants: Variant[] = [];
  for (const r of rewriteResults) {
    if (r.status !== 'fulfilled') continue;
    const rv = r.value;
    if ('skipped' in rv && rv.skipped) {
      rewrites.push({
        index: rv.index,
        text: '',
        costUsd: 0,
        formatValid: false,
        ...(rv.temperature !== undefined && { temperature: rv.temperature }),
        status: 'skipped_slot_abort',
      });
      continue;
    }
    if ('error' in rv) {
      rewrites.push({
        index: rv.index,
        text: '',
        costUsd: 0,
        formatValid: false,
        ...(rv.temperature !== undefined && { temperature: rv.temperature }),
        status: 'llm_error',
      });
      continue;
    }
    if (!('validation' in rv)) continue;
    const valid = rv.validation.valid;
    const variantId = valid ? generateVariantId() : undefined;
    rewrites.push({
      index: rv.index,
      text: rv.text,
      ...(variantId && { slotVariantId: variantId }),
      costUsd: rv.costUsd,
      durationMs: rv.durationMs,
      ...(rv.temperature !== undefined && { temperature: rv.temperature }),
      formatValid: valid,
      status: valid ? 'succeeded' : 'dropped',
      ...(!valid && rv.validation.dropReason && { dropReason: rv.validation.dropReason }),
    });
    if (valid && variantId) {
      survivingRewriteVariants.push({
        id: variantId,
        text: rv.text,
        tactic: 'paragraph_rewrite',
        version: 0,
        parentIds: [originalSlotVariantId],
        createdAt: Date.now() / 1000,
        iterationBorn: ctx.iteration,
        agentName: 'paragraph_rewrite',
        variantKind: 'paragraph',
      });
    }
  }

  // ─── No surviving rewrites → parent fallback ─────────────────────
  if (survivingRewriteVariants.length === 0) {
    return {
      slotDetail: {
        slotIndex: slot.paragraphIndex,
        originalText: slot.originalText,
        originalSlotVariantId,
        slotTopicId: topicId,
        perSlotBudgetUsd,
        spentUsd: slotScope.getOwnSpent!(),
        rewrites,
        discardReason: { failurePoint: 'no_valid_rewrites' },
      },
      winnerText: slot.originalText,
      winnerIsOriginal: true,
      allRewritesFailed: true,
    };
  }

  // ─── Sequential per-slot ranking with PRIOR CONTEXT (B.6) ────────
  // investigate_sequential_paragraph_recombine_performance_20260615 Phase 1d (Fix 5b):
  // Article rubric is stripped at slot level (article-shaped dimensions don't apply at
  // single-paragraph scale). Slot level uses the optional paragraphJudgeRubric if the
  // strategy configured one; else undefined → judge falls back to the hardcoded
  // paragraph rubric (with Phase 1c-ii + 1c-iii edits applied). See structured_judging_
  // evolution_20260610 for the original strip rationale.
  const slotConfig = ctx.config;
  const { judgeRubric: _droppedArticleRubric, ...slotConfigNoRubric } = slotConfig;
  const perSlotConfig = {
    ...slotConfigNoRubric,
    judgeRubric: slotConfig.paragraphJudgeRubric,
    maxComparisonsPerVariant: 6,
    comparisonMode: 'paragraph' as const,
  };
  const slotMatches: import('../../../pipeline/infra/types').V2Match[] = [];
  const rankingLogger = slotLogger.child?.('ranking') ?? slotLogger;
  const toRankLabel = (label: string): 'paragraph_rank' | typeof label =>
    label === 'ranking' ? 'paragraph_rank' : label;
  const rankLlm: EvolutionLLMClient = {
    complete: (prompt, label, options) =>
      slotLlm.complete(prompt, toRankLabel(label) as typeof label, options),
    completeStructured: (prompt, schema, schemaName, label, options) =>
      slotLlm.completeStructured(prompt, schema, schemaName, toRankLabel(label) as typeof label, options),
  };
  const phasesBeforeRanking = slotScope.getPhaseCosts();
  const rankBefore = phasesBeforeRanking['paragraph_rank'] ?? 0;
  let rankingStatus: 'completed' | 'self_aborted' | 'skipped_insufficient_pool' = 'completed';
  for (const candidate of survivingRewriteVariants) {
    try {
      const beforeRatings = new Map<string, Rating>();
      for (const [id, r] of localRatings) beforeRatings.set(id, { ...r });
      const result = await rankNewVariant({
        variant: candidate,
        localPool,
        localRatings,
        localMatchCounts,
        completedPairs,
        cache,
        llm: rankLlm,
        config: perSlotConfig,
        invocationId: ctx.invocationId,
        logger: rankingLogger,
        costTracker: slotScope,
        priorPicks,
        nextContext,
        // Phase 4a-2: parent's slot-N text — sanitized at the same boundary as
        // priorPicks/nextContext so a parent paragraph containing a literal
        // </UNTRUSTED_ORIGINAL> tag cannot break out of the new tag scope.
        originalParagraph: sanitizeForPriorContext(slot.originalText).sanitized,
      });
      for (const match of result.rankResult.matches) {
        const aBefore = beforeRatings.get(match.winnerId) ?? createRating();
        const bBefore = beforeRatings.get(match.loserId) ?? createRating();
        const aAfter = localRatings.get(match.winnerId) ?? createRating();
        const bAfter = localRatings.get(match.loserId) ?? createRating();
        beforeAfterRatings.set(makeMatchKey(match.winnerId, match.loserId), {
          aBefore, aAfter, bBefore, bAfter,
        });
        slotMatches.push(match);
      }
    } catch {
      /* non-fatal */
    }
    if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION_LOCAL * perSlotBudgetUsd) {
      rankingStatus = 'self_aborted';
      break;
    }
  }
  const phasesAfterRanking = slotScope.getPhaseCosts();
  const rankAfter = phasesAfterRanking['paragraph_rank'] ?? 0;
  const rankingCost = Math.max(0, rankAfter - rankBefore);

  // ─── Pick winner ─────────────────────────────────────────────────
  const winnerCandidates: WinnerCandidate[] = localPool.map((v) => ({ id: v.id }));
  let winnerSlotVariantId = originalSlotVariantId;
  let winnerIsOriginal = true;
  let winnerSource: 'this_invocation' | 'prior_invocation' | 'original' = 'original';
  try {
    const winnerResult = selectWinner(winnerCandidates, localRatings);
    winnerSlotVariantId = winnerResult.winnerId;
    winnerIsOriginal = winnerSlotVariantId === originalSlotVariantId;
    if (winnerIsOriginal) {
      winnerSource = 'original';
    } else if (survivingRewriteVariants.some((v) => v.id === winnerSlotVariantId)) {
      winnerSource = 'this_invocation';
    } else {
      winnerSource = 'prior_invocation';
    }
  } catch {
    /* stays with original */
  }

  const winnerVariant = localPool.find((v) => v.id === winnerSlotVariantId);
  const winnerText = winnerVariant?.text ?? slot.originalText;

  // ─── Arena sync + match persistence ──────────────────────────────
  try {
    await syncToArena(
      ctx.runId,
      topicId,
      localPool.filter((v) => survivingRewriteVariants.some((s) => s.id === v.id)),
      localRatings,
      slotMatches,
      ctx.db,
      false,
      slotLogger,
    );
  } catch (err) {
    return {
      slotDetail: {
        slotIndex: slot.paragraphIndex,
        originalText: slot.originalText,
        originalSlotVariantId,
        slotTopicId: topicId,
        perSlotBudgetUsd,
        spentUsd: slotScope.getOwnSpent!(),
        rewrites,
        discardReason: { failurePoint: 'sync_failed', message: err instanceof Error ? err.message : String(err) },
      },
      winnerText: slot.originalText,
      winnerIsOriginal: true,
      allRewritesFailed: true,
    };
  }

  if (slotMatches.length > 0) {
    await persistSlotMatches(
      ctx.db,
      topicId,
      ctx.runId,
      ctx.invocationId,
      ctx.iteration,
      slotMatches,
      beforeAfterRatings,
    );
  }

  return {
    slotDetail: {
      slotIndex: slot.paragraphIndex,
      originalText: slot.originalText,
      originalSlotVariantId,
      slotTopicId: topicId,
      perSlotBudgetUsd,
      spentUsd: slotScope.getOwnSpent!(),
      rewrites,
      ranking: {
        matchCount: slotMatches.length,
        comparisonCount: slotMatches.length,
        cost: rankingCost,
        status: rankingStatus,
        ratings: Array.from(localRatings.entries()).map(([variantId, r]) => ({
          variantId,
          elo: r.elo,
          uncertainty: r.uncertainty,
        })),
        winnerSlotVariantId,
        winnerIsOriginal,
        winnerSource,
      },
    },
    winnerText,
    winnerIsOriginal,
    allRewritesFailed: false,
  };
}

const SLOT_SELF_ABORT_FRACTION_LOCAL = 0.9;

function generateVariantId(): string {
  return globalThis.crypto.randomUUID();
}
