// ParagraphRecombineAgent: decomposes a parent article into paragraphs, generates M rewrites
// per slot in parallel, ranks per slot via the existing Elo machinery, and recombines per-slot
// winners into one new article variant.
//
// Per the planning doc at docs/planning/rank_individual_paragraphs_evolution_20260525/.
//
// LOAD-BEARING INVARIANTS (inherited from ProposerApproverCriteriaGenerateAgent per D11):
//   I1. Inner LLM helpers use input.llm directly. No nested Agent.run().
//   I2. Cost-before-call snapshots before each helper call so per-purpose cost split fills
//       execution_detail correctly.
//   I3. Write partial execution_detail BEFORE re-throwing on any helper failure.
//
// PARAGRAPH_RECOMBINE-SPECIFIC INVARIANTS:
//   D16. Per-slot AgentCostScope nested under invocationScope; self-abort at 0.9× perSlotBudget.
//   D18. All N slots run in parallel via Promise.allSettled; M rewrites within each slot also
//        in parallel; per-slot pairwise ranking is SEQUENTIAL (rankNewVariant mutates local
//        pool/ratings/matchCounts in place — concurrent calls would corrupt them).
//   D4.  parent_variant_ids = [originalParent] only — slot winners live in
//        execution_detail.slots[i].winnerSlotVariantId, NOT in parent_variant_ids.
//   D10. Per-slot match persistence via persistSlotMatches (Phase 3 helper), NOT MergeRatingsAgent
//        (whose ctx.promptId would misroute to the article topic).

import { Agent } from '../../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from '../../types';
import type { ExecutionDetailBase, EvolutionLLMClient } from '../../../types';
import { type Variant, createVariant } from '../../../types';
import { slotRecombineExecutionDetailSchema, type SlotRecombineExecutionDetail } from '../../../schemas';
import { registerAttributionExtractor } from '../../../metrics/attributionExtractors';
import { createAgentCostScope, type AgentCostScope } from '../../../pipeline/infra/trackBudget';
import { createEvolutionLLMClient } from '../../../pipeline/infra/createEvolutionLLMClient';
import { extractParagraphsWithRanges, validateParagraphRewrite, assembleRecombinedArticle } from '../../../shared/paragraphSlots';
import { rankNewVariant } from '../../../pipeline/loop/rankNewVariant';
import { loadArenaEntries } from '../../../pipeline/setup/buildRunContext';
import { selectWinner, type WinnerCandidate } from '../../../shared/selectWinner';
import { createRating, type Rating, type ComparisonResult } from '../../../shared/computeRatings';
import { syncToArena } from '../../../pipeline/finalize/persistRunResults';
import { writeMetricMax } from '../../../metrics/writeMetrics';
import type { MetricName } from '../../../metrics/types';
import { validateFormat } from '../../../shared/enforceVariantFormat';
import {
  upsertSlotTopic,
  persistSlotMatches,
  makeMatchKey,
  type BeforeAfterRatingsMap,
} from '../../../../services/slotTopicActions';
import { buildParagraphRewritePrompt, PARAGRAPH_REWRITE_DIRECTIVES } from './buildParagraphRewritePrompt';
import { getModelMaxTemperature } from '@/config/modelRegistry';
import { estimateParagraphRecombineCost } from '../../../pipeline/infra/estimateCosts';
import { sentenceVerbatimOverlap } from '../../../shared/sentenceOverlap';
// Sequential Context-Aware Generation (debug_performance_paragraph_recombine_20260612).
import { runCoordinator, CoordinatorLLMError, CoordinatorParseError } from './coordinator';
import { runSequentialLoop, type SequentialCounters } from './sequentialExecute';
import type { CoordinatorPlan } from '../../../schemas';

// ─── Defaults (per D9) ────────────────────────────────────────────

const DEFAULT_REWRITES_PER_PARAGRAPH = 3;
const DEFAULT_MAX_COMPARISONS_PER_PARAGRAPH = 6;
const DEFAULT_MAX_PARAGRAPHS_PER_INVOCATION = 12;
// Sequential context-aware generation (debug_performance_paragraph_recombine_20260612):
// env-flag-aware per-invocation cap. Sequential mean cost ~$0.016, worst case ~$0.045.
// $0.060 cap covers worst case with ~25% headroom. Legacy parallel path keeps $0.05 cap.
const SEQUENTIAL_PER_INVOCATION_CAP_USD = 0.060;
const LEGACY_PER_INVOCATION_CAP_USD = 0.05;
const DEFAULT_PER_INVOCATION_CAP_USD = LEGACY_PER_INVOCATION_CAP_USD;
const PRE_FINAL_RANKING_GATE_FRACTION = 0.9;
const SLOT_SELF_ABORT_FRACTION = 0.9;

/** Sequential context-aware generation (debug_performance_paragraph_recombine_20260612):
 *  the env-flag governs whether the agent runs the new sequential path or falls through
 *  to the legacy parallel-slot dispatch. Default `'true'`. */
export function isSequentialEnabled(): boolean {
  return process.env.EVOLUTION_PARAGRAPH_RECOMBINE_SEQUENTIAL_ENABLED !== 'false';
}

/** Env-flag-aware cap function. Pass an explicit env value for projector use (so wizard
 *  preview matches runtime when the projector runs client-side). When omitted, reads
 *  process.env at runtime. */
export function getDefaultPerInvocationCapUsd(sequentialEnabled?: boolean): number {
  const enabled = sequentialEnabled ?? isSequentialEnabled();
  return enabled ? SEQUENTIAL_PER_INVOCATION_CAP_USD : LEGACY_PER_INVOCATION_CAP_USD;
}

/** B.5 — low-cap strategy guard. When the strategy's `perInvocationCapUsd` is below
 *  the sequential mean cost ($0.016), fall through to the parallel legacy path even
 *  with env flag on. Strategies can opt OUT of legacy via the SEQUENTIAL_OPT_OUT set
 *  (empty by default; populate when an operator decides to force legacy for an audit). */
const SEQUENTIAL_LOW_CAP_THRESHOLD_USD = 0.016;
const PARAGRAPH_RECOMBINE_SEQUENTIAL_OPT_OUT: ReadonlySet<string> = new Set<string>([
  // Add strategy IDs here ONLY to force the legacy parallel path regardless of cap.
]);

function shouldForceLegacyForLowCap(
  perInvocationCapUsd: number,
  strategyId: string | undefined,
): boolean {
  if (perInvocationCapUsd >= SEQUENTIAL_LOW_CAP_THRESHOLD_USD
      && !(strategyId && PARAGRAPH_RECOMBINE_SEQUENTIAL_OPT_OUT.has(strategyId))) {
    return false;
  }
  return true;
}

/** Lower bound of the per-rewrite temperature ladder. Raised from 1.0 → 1.2 by
 *  investigate_paragraph_recombine_invocation_20260529. Index-0 is now special-cased
 *  to a lower value (see PARAGRAPH_REWRITE_INDEX_0_TEMP).
 *
 *  I3b (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): the 1.2
 *  floor still produced 92-100% `length_under` drops on index-0 (the "tighten"
 *  directive). Per R4D: index-0 outputs landed at 0.50–0.74 of original (mean 0.67),
 *  well below the 0.8 validator floor. Diagnosis: at high temperature the LLM
 *  over-compresses aggressively despite the explicit floor directive. Fix: drop
 *  index-0 to 0.7 while keeping index-1/2 on the diversity ladder. The "tighten"
 *  directive itself provides the variance index-0 needs from the prompt; high
 *  temperature just made the LLM ignore the length constraint. */
const PARAGRAPH_REWRITE_TEMP_FLOOR = 1.2;
const PARAGRAPH_REWRITE_INDEX_0_TEMP = 0.7;

/** Per-rewrite temperature ladder. For index-0 ("tighten" directive) we use a low
 *  temperature (0.7) for length compliance; for index-1+ we use the 1.2–2.0 diversity
 *  ladder so the "add example" and "improve flow" rewrites get genuine variance.
 *  Schedule for index ≥ 1: `FLOOR + (index-1)*(2.0 - FLOOR)/(M-2)` when M ≥ 3,
 *  collapsing to FLOOR when M < 3. M=1 (no diversity needed) returns 0.7. Clamped to
 *  the model's maxTemperature; returns undefined when the model rejects temperature. */
export function paragraphRewriteTemperature(
  index: number,
  total: number,
  maxTemp: number | null | undefined,
): number | undefined {
  if (maxTemp === null) return undefined; // model doesn't support temperature → omit option
  let base: number;
  if (index === 0) {
    // I3b: index-0 ("tighten") always low-temp for length compliance.
    base = PARAGRAPH_REWRITE_INDEX_0_TEMP;
  } else if (total <= 2) {
    // M=2 only has index 0 and index 1; put index 1 at the high end for diversity.
    base = 2.0;
  } else {
    // M ≥ 3: index ≥ 1 walks the 1.2–2.0 ladder.
    base = PARAGRAPH_REWRITE_TEMP_FLOOR + ((index - 1) * (2.0 - PARAGRAPH_REWRITE_TEMP_FLOOR)) / (total - 2);
  }
  return typeof maxTemp === 'number' ? Math.min(base, maxTemp) : base; // undefined (unknown model) → pass through
}

// ─── Types ────────────────────────────────────────────────────────

export interface ParagraphRecombineInput {
  /** Parent article text being decomposed. */
  parentText: string;
  /** Parent variant UUID — used for paragraph_variant_ids lineage and topic naming. */
  parentVariantId: string;
  rewritesPerParagraph?: number;
  maxComparisonsPerParagraph?: number;
  maxParagraphsPerInvocation?: number;
  perInvocationCapUsd?: number;
  /** Run pool / ratings / matchCounts / cache for article-level ranking of the recombined
   *  variant (Task 3). When `initialPool` is non-empty, the agent ranks the recombined
   *  variant against it via `rankNewVariant` and returns the resulting `matches` for the
   *  loop's MergeRatingsAgent. Omitted (e.g. seed-only first iteration) → no article rank. */
  initialPool?: Variant[];
  initialRatings?: Map<string, Rating>;
  initialMatchCounts?: Map<string, number>;
  cache?: Map<string, ComparisonResult>;
  /** Optional per-call llm injected by Agent.run when ctx.rawProvider is set.
   *  Tests can pass directly. */
  llm?: EvolutionLLMClient;
}

export interface ParagraphRecombineOutput {
  /** The recombined article variant. Null when no variant was emitted (e.g. format-rejected). */
  variant: Variant | null;
  /** True iff the recombined variant passed validation and is competing in arena. */
  surfaced: boolean;
  /** Compatibility with GenerateFromPreviousOutput so this agent can flow through
   *  the dispatch loop's parallel-batch result handler. paragraph_recombine doesn't have
   *  a binary-search status; we report 'converged' on success and 'generation_failed'
   *  on no-variant paths. */
  status: 'converged' | 'generation_failed';
  /** Article-level ranking matches for the recombined variant (from Step 6's rankNewVariant).
   *  The loop's dedicated paragraph_recombine branch feeds these to MergeRatingsAgent for the
   *  authoritative global rating update. Empty when no variant surfaced or there's no run pool
   *  to rank against (e.g. a seed-only first iteration). Distinct from per-slot (paragraph-level)
   *  matches, which are persisted inline by persistSlotMatches. */
  matches: import('../../../pipeline/infra/types').V2Match[];
}

// ─── Agent class ──────────────────────────────────────────────────

export class ParagraphRecombineAgent extends Agent<
  ParagraphRecombineInput,
  ParagraphRecombineOutput,
  SlotRecombineExecutionDetail
> {
  readonly name = 'paragraph_recombine';
  readonly executionDetailSchema = slotRecombineExecutionDetailSchema;
  readonly detailViewConfig: DetailFieldDef[] = []; // Phase 6 fills this in.
  readonly usesLLM = true;

  override getAttributionDimension(_detail: SlotRecombineExecutionDetail): string | null {
    return 'paragraph_recombine';
  }

  async execute(
    input: ParagraphRecombineInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<ParagraphRecombineOutput, SlotRecombineExecutionDetail>> {
    // Sequential context-aware generation (debug_performance_paragraph_recombine_20260612):
    // env-flag-aware default cap. Sequential path uses $0.060; legacy uses $0.05. The B.5
    // low-cap opt-out + manually-set low caps fall through to legacy regardless of env.
    const sequentialEnabledByEnv = isSequentialEnabled();
    const effectiveCapUsd = input.perInvocationCapUsd ?? getDefaultPerInvocationCapUsd(sequentialEnabledByEnv);
    const sequentialEnabled =
      sequentialEnabledByEnv && !shouldForceLegacyForLowCap(effectiveCapUsd, ctx.strategyId);

    const {
      parentText,
      parentVariantId,
      rewritesPerParagraph = DEFAULT_REWRITES_PER_PARAGRAPH,
      maxComparisonsPerParagraph = DEFAULT_MAX_COMPARISONS_PER_PARAGRAPH,
      maxParagraphsPerInvocation = DEFAULT_MAX_PARAGRAPHS_PER_INVOCATION,
      llm,
    } = input;
    const perInvocationCapUsd = effectiveCapUsd;

    if (!llm) {
      throw new Error('ParagraphRecombineAgent: input.llm is required (Agent.run() should inject it)');
    }

    const invocationScope = ctx.costTracker as AgentCostScope;
    if (typeof invocationScope.getOwnSpent !== 'function') {
      throw new Error('ParagraphRecombineAgent: ctx.costTracker must be an AgentCostScope (B012)');
    }

    // PHASE_COSTS_ENTRY: pin invocation-scope baseline before any LLM call mutates the
    // shared accumulator. Phase 12 makes getPhaseCosts() return run-cumulative (delegating
    // to runTracker); without subtracting this entry snapshot, the per-invocation cost
    // accounting at the bottom of execute() would include prior multi-dispatch siblings'
    // spend AND prior iters' spend, producing a +K× inflated estimationErrorPct.
    //
    // Multi-dispatch K>1 invariant: each parallel paragraph_recombine invocation gets its
    // OWN AgentCostScope (via Agent.run()), but getPhaseCosts() delegates to the shared
    // run-level tracker. Invocation #N's phasesAtEntry captures invocations 1..N-1's
    // accumulated paragraph_rewrite/paragraph_rank spend; subtracting at execute() exit
    // yields ONLY this invocation's delta — which is what execution_detail.paragraph_*.cost
    // and estimationErrorPct must record.
    const phasesAtEntry = invocationScope.getPhaseCosts();

    // ─── Step 1: Decompose ─────────────────────────────────────────
    const allSlots = extractParagraphsWithRanges(parentText);
    const slots = allSlots.slice(0, maxParagraphsPerInvocation);
    const paragraphCount = slots.length;
    const perSlotBudgetUsd = paragraphCount > 0 ? perInvocationCapUsd / paragraphCount : 0;

    // ─── G4 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):
    // Capture projector output at dispatch time with the ACTUAL inputs (parent length,
    // slot count, rewrites per slot, judge/rewriter models). Persisted into
    // execution_detail so the run/strategy/experiment-level `cost_estimation_error_pct`
    // and `estimated_cost` metric family auto-joins for paragraph_recombine without
    // requiring any finalization.ts changes (the existing compute functions iterate
    // all invocation details agnostic to agent_name).
    const rewriteModelForProjector = ctx.defaultModel ?? 'gpt-4.1-nano';
    const judgeModelForProjector = ctx.config?.judgeModel ?? 'qwen-2.5-7b-instruct';
    const projection = estimateParagraphRecombineCost(
      parentText.length,
      paragraphCount,
      rewritesPerParagraph,
      maxComparisonsPerParagraph,
      rewriteModelForProjector,
      judgeModelForProjector,
      { sequentialEnabled },
    );

    // Extract H1 title from parent for the rewrite prompt's context.
    const parentH1 = extractH1(parentText);

    // Accumulator for execution_detail.slots[i] (populated in per-slot processing).
    let slotDetails: SlotRecombineExecutionDetail['slots'] = [];
    const slotWinnerTexts = new Map<number, string>();

    // Sequential coordinator detail accumulator (only populated on sequential path).
    let coordinatorPlan: CoordinatorPlan | undefined;
    let coordinatorRetried = false;
    let coordinatorRawResponse: string | undefined;
    let coordinatorPartialAt: number | undefined;
    let coordinatorAbortReason: string | undefined;
    let coordinatorCompletedSlotCount: number | undefined;
    let sequentialCounters: SequentialCounters | undefined;

    if (sequentialEnabled && paragraphCount > 0) {
      // ─── Phase A: Coordinator ───────────────────────────────────
      try {
        const coordResult = await runCoordinator({
          parentText,
          paragraphCount,
          llm,
          generationModel: rewriteModelForProjector,
          ...(ctx.invocationId !== undefined && ctx.invocationId !== '' && { invocationId: ctx.invocationId }),
        });
        coordinatorPlan = coordResult.plan;
        coordinatorRetried = coordResult.retried;
        coordinatorRawResponse = coordResult.rawResponse;
      } catch (err) {
        // Coordinator throw → persist partial detail (cost + raw response + parse error)
        // BEFORE re-throwing per I3 invariant. Agent.run() handles the throw → success=false.
        const partialDetailOnThrow: SlotRecombineExecutionDetail = {
          detailType: 'paragraph_recombine',
          parentVariantId,
          slots: [],
          recombined: { text: parentText, formatValid: false },
          totalCost: invocationScope.getOwnSpent!(),
          coordinator: {
            estimatedCost: projection.perPhase.coordinatorCost,
            cost: invocationScope.getOwnSpent!(),
            retried: err instanceof CoordinatorParseError, // retry happened only on parse path
            ...(err instanceof CoordinatorParseError && {
              rawResponse: err.rawResponse.slice(0, 4000),
              parseError: err.parseError.slice(0, 4000),
            }),
            ...(err instanceof CoordinatorLLMError && err.rawResponse !== undefined && {
              rawResponse: err.rawResponse.slice(0, 4000),
            }),
          },
        };
        await safeUpdateInvocation(ctx, partialDetailOnThrow);
        throw err;
      }

      // ─── Phase B: Sequential per-paragraph loop ────────────────
      // B.7 try/catch wraps the loop so a mid-loop throw persists execution_detail.slots[0..i-1]
      // + partialAt + abortReason + completedSlotCount BEFORE re-throwing.
      try {
        const seqResult = await runSequentialLoop({
          slots,
          paragraphCount,
          parentVariantId,
          coordinatorPlan,
          perInvocationCapUsd,
          rewriteModel: rewriteModelForProjector,
          judgeModel: judgeModelForProjector,
          invocationScope,
          ctx,
          llm,
        });
        slotDetails = seqResult.slotDetails;
        for (const [idx, text] of seqResult.slotWinnerTexts) {
          slotWinnerTexts.set(idx, text);
        }
        sequentialCounters = seqResult.counters;
      } catch (err) {
        const completed = slotDetails.length;
        coordinatorPartialAt = completed;
        coordinatorAbortReason = String(err instanceof Error ? err.message : err).slice(0, 1000);
        coordinatorCompletedSlotCount = completed;
        // Build the partial-detail-on-throw with what we have.
        const partialDetailOnThrow: SlotRecombineExecutionDetail = {
          detailType: 'paragraph_recombine',
          parentVariantId,
          slots: slotDetails, // truncated: slots.length === completed (NOT N-with-nulls)
          recombined: { text: parentText, formatValid: false },
          totalCost: invocationScope.getOwnSpent!(),
          coordinatorPlan,
          partialAt: completed,
          abortReason: coordinatorAbortReason,
          completedSlotCount: completed,
        };
        await safeUpdateInvocation(ctx, partialDetailOnThrow);
        throw err;
      }
    } else {
      // ─── Legacy parallel path (D18) ────────────────────────────
      await Promise.allSettled(
        slots.map((slot) =>
          processSlot({
            slot,
            parentText,
            parentVariantId,
            parentH1,
            totalSlots: paragraphCount,
            rewritesPerParagraph,
            maxComparisonsPerParagraph,
            perSlotBudgetUsd,
            invocationScope,
            ctx,
            llm,
            slotDetails,
            slotWinnerTexts,
          }),
        ),
      );
    }

    // Sort slotDetails by slotIndex so the detail is deterministic.
    slotDetails.sort((a, b) => a.slotIndex - b.slotIndex);

    // G5 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): compute
    // per-phase actuals from the run-cumulative shared tracker, then compute
    // estimationErrorPct = (actual - estimated) / estimated × 100 for both per-phase
    // and top-level. Persisted into the execution_detail base populated below.
    //
    // Phase 12: subtract phasesAtEntry to get THIS invocation's delta only. With
    // getPhaseCosts() now returning run-cumulative (post-12.2), reading totalPhaseCosts
    // directly would inflate per-invocation accounting by all prior siblings + iters.
    const phasesAfter = invocationScope.getPhaseCosts();
    const actualRewriteCost = (phasesAfter['paragraph_rewrite'] ?? 0) - (phasesAtEntry['paragraph_rewrite'] ?? 0);
    const actualRankCost = (phasesAfter['paragraph_rank'] ?? 0) - (phasesAtEntry['paragraph_rank'] ?? 0);
    const actualCoordinatorCost = (phasesAfter['paragraph_recombine_coordinator'] ?? 0)
      - (phasesAtEntry['paragraph_recombine_coordinator'] ?? 0);
    // 3-phase total — matches paragraph_recombine_cost rollup below. Phase 12 invariant:
    // computed AFTER Phase B/legacy loop completes so all 3 accumulators have landed.
    const actualTotalCost = actualRewriteCost + actualRankCost + actualCoordinatorCost;
    const pctError = (actual: number, est: number): number | undefined => {
      if (est <= 0 || !Number.isFinite(actual) || !Number.isFinite(est)) return undefined;
      return ((actual - est) / est) * 100;
    };
    const estimationErrorPct = pctError(actualTotalCost, projection.expected);
    const paragraphRewriteErrorPct = pctError(actualRewriteCost, projection.perPhase.paragraphRewriteCost);
    const paragraphRankErrorPct = pctError(actualRankCost, projection.perPhase.paragraphRankCost);
    const coordinatorErrorPct = pctError(actualCoordinatorCost, projection.perPhase.coordinatorCost);

    // Run-level paragraph_recombine_cost = sum of 3 phase-cost accumulators. MAX-safe
    // because all 3 are run-cumulative under the Phase 12 invariant. Written here AFTER
    // the Phase B loop completes (and BEFORE article-level rank fires below), so spend
    // is recorded on every return path including no-variant outcomes.
    if (ctx.db && ctx.runId) {
      const phases = invocationScope.getPhaseCosts();
      const paragraphCost = (phases['paragraph_rewrite'] ?? 0)
        + (phases['paragraph_rank'] ?? 0)
        + (phases['paragraph_recombine_coordinator'] ?? 0);
      try {
        await writeMetricMax(ctx.db, 'run', ctx.runId, 'paragraph_recombine_cost' as MetricName, paragraphCost, 'during_execution');
      } catch (err) {
        ctx.logger.warn?.('paragraph_recombine_cost write failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ─── Step 3: Assemble recombined article + validate format ────
    const recombinedText = assembleRecombinedArticle(parentText, slots, slotWinnerTexts);
    const formatResult = validateFormat(recombinedText);

    const partialDetail: SlotRecombineExecutionDetail = {
      detailType: 'paragraph_recombine',
      parentVariantId,
      slots: slotDetails,
      recombined: {
        text: recombinedText,
        formatValid: formatResult.valid,
        ...(formatResult.issues.length > 0 && { formatIssues: formatResult.issues }),
      },
      totalCost: invocationScope.getOwnSpent!(),
      // G4/G5: projector output + actuals + per-phase split.
      estimatedTotalCost: projection.expected,
      estimatedTotalCostUpperBound: projection.upperBound,
      ...(estimationErrorPct !== undefined && { estimationErrorPct }),
      paragraph_rewrite: {
        estimatedCost: projection.perPhase.paragraphRewriteCost,
        cost: actualRewriteCost,
        ...(paragraphRewriteErrorPct !== undefined && { estimationErrorPct: paragraphRewriteErrorPct }),
      },
      paragraph_rank: {
        estimatedCost: projection.perPhase.paragraphRankCost,
        cost: actualRankCost,
        ...(paragraphRankErrorPct !== undefined && { estimationErrorPct: paragraphRankErrorPct }),
      },
      ...(sequentialEnabled && {
        coordinator: {
          estimatedCost: projection.perPhase.coordinatorCost,
          cost: actualCoordinatorCost,
          ...(coordinatorErrorPct !== undefined && { estimationErrorPct: coordinatorErrorPct }),
          ...(coordinatorRetried && { retried: coordinatorRetried }),
          ...(coordinatorRawResponse !== undefined && { rawResponse: coordinatorRawResponse.slice(0, 4000) }),
        },
        ...(coordinatorPlan && { coordinatorPlan }),
        ...(sequentialCounters && { sequentialCounters }),
      }),
    };
    // coordinatorPartialAt/AbortReason/CompletedSlotCount are assigned in Phase B's catch
    // block (lines 351-353) and used there to build partialDetailOnThrow before re-throw —
    // they are intentionally NOT included in the happy-path partialDetail above.
    void coordinatorPartialAt;
    void coordinatorAbortReason;
    void coordinatorCompletedSlotCount;

    if (!formatResult.valid) {
      // Persist partial detail before returning (I3).
      await safeUpdateInvocation(ctx, partialDetail);
      return {
        result: { variant: null, surfaced: false, status: 'generation_failed', matches: [] },
        detail: partialDetail,
        // D1 (fix_structured_judging_evolution_bugs): the recombined ARTICLE failed format
        // validation → no usable variant produced → hard fail (consistent with GFPA format-invalid).
        failure: { code: 'format_invalid', message: 'recombined article failed format validation' },
      };
    }

    // ─── Step 4: Pre-final-ranking budget gate (D6/D9) ────────────
    if (invocationScope.getOwnSpent!() >= PRE_FINAL_RANKING_GATE_FRACTION * perInvocationCapUsd) {
      await safeUpdateInvocation(ctx, partialDetail);
      // D1: this is a deliberate BUDGET headroom gate, NOT a failure — do NOT set `failure`
      // (analogous to GFPA's 'budget' status). The invocation stays success=true.
      return {
        result: { variant: null, surfaced: false, status: 'generation_failed', matches: [] },
        detail: partialDetail,
      };
    }

    // ─── Step 5: Build the recombined Variant ─────────────────────
    // Per revised D4: parent_variant_ids = [parentVariant.id] only.
    // Slot winners live in execution_detail.slots[i].winnerSlotVariantId.
    //
    // Phase 10: compute sentence_verbatim_ratio mirroring generateFromPreviousArticle.ts:259-267.
    // The metric is "universal" per evolution/docs/metrics.md; paragraph_recombine variants
    // have a single comparable parent (D4) so the ratio is meaningful. Note: SVR is inflated
    // for paragraph_recombine vs GFPA because preserved-original slots (winnerSource='original'
    // or no_valid_rewrites discards) keep parent sentences verbatim. This is observational only.
    let sentenceVerbatimRatio: number | undefined;
    try {
      sentenceVerbatimRatio = sentenceVerbatimOverlap(parentText, recombinedText).ratio;
    } catch (err) {
      ctx.logger.warn('sentence-overlap compute failed; ratio stays NULL', {
        phaseName: 'recombine',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const recombinedVariant = createVariant({
      text: recombinedText,
      tactic: 'paragraph_recombine',
      iterationBorn: ctx.iteration,
      parentIds: [parentVariantId],
      agentInvocationId: ctx.invocationId === '' ? undefined : ctx.invocationId,
      ...(sentenceVerbatimRatio !== undefined && { sentenceVerbatimRatio }),
    });

    // ─── Step 6: Article-level ranking (Task 3) ───────────────────
    // Rank the recombined variant against the run's article pool so it competes for the
    // run winner. Uses input.llm (the invocation-scoped client → 'ranking' label →
    // ranking_cost) — NOT the per-slot rankLlm relabel proxy. rankNewVariant mutates the
    // CLONES passed here; the loop's dedicated paragraph_recombine branch feeds the returned
    // matches to MergeRatingsAgent (the authoritative global update). Skipped when there's
    // no run pool to rank against (e.g. a seed-only first iteration).
    let articleMatches: import('../../../pipeline/infra/types').V2Match[] = [];
    let surfaced = true;
    if (input.initialPool && input.initialPool.length > 0) {
      const rankPool: Variant[] = [...input.initialPool];
      const rankRatings = new Map<string, Rating>();
      for (const [id, r] of input.initialRatings ?? new Map<string, Rating>()) {
        rankRatings.set(id, { ...r });
      }
      const articleRank = await rankNewVariant({
        variant: recombinedVariant,
        localPool: rankPool,
        localRatings: rankRatings,
        localMatchCounts: new Map<string, number>(input.initialMatchCounts ?? new Map()),
        completedPairs: new Set<string>(),
        cache: input.cache ?? new Map(),
        llm,
        config: ctx.config,
        invocationId: ctx.invocationId,
        logger: ctx.logger,
        costTracker: invocationScope,
      });
      articleMatches = articleRank.rankResult.matches;
      surfaced = articleRank.surfaced;
    }

    // Finalize execution_detail and persist.
    const finalDetail: SlotRecombineExecutionDetail = {
      ...partialDetail,
      totalCost: invocationScope.getOwnSpent!(),
    };
    await safeUpdateInvocation(ctx, finalDetail);

    return {
      result: { variant: recombinedVariant, surfaced, status: 'converged', matches: surfaced ? articleMatches : [] },
      detail: finalDetail,
      childVariantIds: [recombinedVariant.id],
      parentVariantIds: [parentVariantId],
    };
  }
}

// ─── Per-slot processor ───────────────────────────────────────────

interface ProcessSlotParams {
  slot: ReturnType<typeof extractParagraphsWithRanges>[number];
  parentText: string;
  parentVariantId: string;
  parentH1: string;
  totalSlots: number;
  rewritesPerParagraph: number;
  maxComparisonsPerParagraph: number;
  perSlotBudgetUsd: number;
  invocationScope: AgentCostScope;
  ctx: AgentContext;
  llm: EvolutionLLMClient;
  slotDetails: SlotRecombineExecutionDetail['slots'];
  slotWinnerTexts: Map<number, string>;
}

async function processSlot(params: ProcessSlotParams): Promise<void> {
  const {
    slot, parentVariantId, parentH1, totalSlots, rewritesPerParagraph, maxComparisonsPerParagraph,
    perSlotBudgetUsd, invocationScope, ctx, llm, slotDetails, slotWinnerTexts,
  } = params;

  // Per-slot state isolation invariant (D18): each parallel processSlot allocates its OWN
  // local pool/ratings/matchCounts/completedPairs/cache. rankNewVariant mutates these in
  // place — sharing across slots would corrupt rankings.
  const localPool: Variant[] = [];
  const localRatings = new Map<string, Rating>();
  const localMatchCounts = new Map<string, number>();
  const completedPairs = new Set<string>();
  const cache = new Map<string, ComparisonResult>();
  const beforeAfterRatings: BeforeAfterRatingsMap = new Map();

  // Default winner = keep the original text (used on any failure path).
  slotWinnerTexts.set(slot.paragraphIndex, slot.originalText);

  // Per-slot AgentCostScope (D16). Nested under invocationScope so the slot self-abort
  // check is independent of sibling slots, while budget reserves still flow up.
  const slotScope = createAgentCostScope(invocationScope);

  // Phase 9 retrofit R3 + Phase 11.0 fix: per-slot logger.child for evolution_logs.subagent_name
  // dotted-path attribution (e.g. 'slot.2'). MUST pass array form (['slot', N]) NOT a single
  // string containing a '.' — `joinSubagentPath` in createEntityLogger.ts:42-67 rejects
  // segments containing literal '.' and returns null, which strips subagent_name on emit.
  // Empirical: pre-fix run 88b5e860-… had 0 rows matching subagent_name LIKE 'slot.%'.
  // Optional-chain because unit tests pass a flat-mock logger without .child(). The
  // rankNewVariant call below gets a further .child('ranking') extension.
  const slotLogger = ctx.logger.child?.(['slot', String(slot.paragraphIndex)]) ?? ctx.logger;

  // Build a per-slot LLM client bound to slotScope so per-paragraph_rewrite calls are
  // attributed to this slot's spend, not aggregated across slots.
  //
  // G8 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): thread
  // db/runId/invocationId so per-slot LLM calls write `llmCallTracking` rows linked
  // back to this invocation. Pre-G8 the per-slot client was db-less, so
  // `paragraph_rewrite`/`paragraph_rank` calls produced ZERO audit rows on staging.
  // The slot's per-call live cost-metric writes via writeMetricMax also become
  // available — but the agent's once-per-invocation rollup write (in execute()
  // below) is monotonic and MAX-safe, so the live writes are belt-and-suspenders.
  const slotLlm = ctx.rawProvider && ctx.defaultModel
    ? createEvolutionLLMClient(
        ctx.rawProvider, slotScope, ctx.defaultModel,
        slotLogger,
        ctx.db, ctx.runId,
        undefined, // generationTemperature: per-rewrite temperature is passed per-call via options
        ctx.invocationId === '' ? undefined : ctx.invocationId,
      )
    : llm; // Tests may pass llm directly without rawProvider.

  // ─── Topic setup (D10) ───────────────────────────────────────────
  let topicId: string;
  let originalSlotVariantId: string;
  try {
    const upsert = await upsertSlotTopic(ctx.db, 'paragraph', parentVariantId, slot.paragraphIndex, slot.originalText);
    topicId = upsert.topicId;
    originalSlotVariantId = upsert.originalSlotVariantId;
  } catch (err) {
    // Topic setup failed: record discardReason and keep original.
    // Phase 11: surface slot discards to evolution_logs at warn level.
    slotLogger.warn?.('paragraph_recombine: slot discarded', {
      slotIndex: slot.paragraphIndex,
      failurePoint: 'sync_failed',
      message: err instanceof Error ? err.message : String(err),
    });
    slotDetails.push({
      slotIndex: slot.paragraphIndex,
      originalText: slot.originalText,
      originalSlotVariantId: '00000000-0000-0000-0000-000000000000', // placeholder; upsert failed
      slotTopicId: '00000000-0000-0000-0000-000000000000',
      perSlotBudgetUsd,
      spentUsd: slotScope.getOwnSpent!(),
      rewrites: [],
      discardReason: { failurePoint: 'sync_failed', message: err instanceof Error ? err.message : String(err) },
    });
    return;
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

  // Load prior arena entries (top-20 by elo_score per D15) as pre-calibrated competitors.
  try {
    const arena = await loadArenaEntries(topicId, ctx.db, undefined, {
      topK: 20,
      alwaysIncludeIds: [originalSlotVariantId],
    });
    for (const v of arena.variants) {
      if (v.id === originalSlotVariantId) continue; // already seeded
      localPool.push(v);
      const rating = arena.ratings.get(v.id);
      if (rating) localRatings.set(v.id, rating);
    }
  } catch {
    // Arena load failure is non-fatal; we proceed with just the original.
  }

  // ─── Rewrites (M parallel; D18) ──────────────────────────────────
  // Each rewrite gets a DISTINCT directive (cycled) + a DISTINCT temperature (1.0–2.0 ladder,
  // clamped to the model cap) so the M rewrites differ on a real quality axis — giving the
  // judge signal to discriminate (Option A). ctx.defaultModel may be undefined in unit tests
  // (no rawProvider) → getModelMaxTemperature(undefined) returns undefined → temps pass through.
  const rewriteMaxTemp = ctx.defaultModel ? getModelMaxTemperature(ctx.defaultModel) : undefined;
  const rewriteResults = await Promise.allSettled(
    Array.from({ length: rewritesPerParagraph }, async (_, index) => {
      // Self-abort check before each rewrite (D16).
      if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION * perSlotBudgetUsd) {
        return { index, skipped: true as const, temperature: undefined as number | undefined };
      }
      const directive = PARAGRAPH_REWRITE_DIRECTIVES[index % PARAGRAPH_REWRITE_DIRECTIVES.length];
      const temperature = paragraphRewriteTemperature(index, rewritesPerParagraph, rewriteMaxTemp);
      const prompt = buildParagraphRewritePrompt(parentH1, slot.originalText, slot.paragraphIndex, totalSlots, directive);
      const tStart = Date.now();
      // G1 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): snapshot
      // per-rewrite cost via slotScope.getOwnSpent() delta. The shared run-cumulative
      // accumulator means per-call deltas can race when rewrites complete concurrently
      // (Promise.allSettled). To get monotonic per-rewrite cost regardless of ordering,
      // we snapshot the slot's `paragraph_rewrite` phase total before and after THIS
      // call's complete() resolves (single-threaded JS event loop guarantees the
      // recordSpend handler for this call settles before the next microtask). Falls
      // back to a 0 cost on error (the release() refunded the reservation).
      const phasesBefore = slotScope.getPhaseCosts();
      const rewriteBefore = phasesBefore['paragraph_rewrite'] ?? 0;
      let text: string;
      try {
        text = await slotLlm.complete(prompt, 'paragraph_rewrite', temperature !== undefined ? { temperature } : undefined);
      } catch (err) {
        return { index, skipped: false as const, error: err instanceof Error ? err.message : String(err), temperature };
      }
      const phasesAfter = slotScope.getPhaseCosts();
      const rewriteAfter = phasesAfter['paragraph_rewrite'] ?? 0;
      const costUsd = Math.max(0, rewriteAfter - rewriteBefore);
      const durationMs = Date.now() - tStart;
      const validation = validateParagraphRewrite(text, slot.originalText.length);
      return { index, skipped: false as const, text, durationMs, validation, costUsd, temperature };
    }),
  );

  // Collect surviving rewrites + record per-rewrite details.
  const rewrites: SlotRecombineExecutionDetail['slots'][number]['rewrites'] = [];
  const survivingRewriteVariants: Variant[] = [];
  for (const r of rewriteResults) {
    if (r.status !== 'fulfilled') continue;
    const rv = r.value;
    if (rv.skipped) {
      // G1: record the skipped status so per-slot drill-down can see which rewrites
      // never fired due to self-abort. Cost is 0 (no LLM call happened).
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
      // G1: LLM call threw. The reserve was release()'d, so cost is 0.
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
    const valid = rv.validation.valid;
    const variantId = valid ? generateVariantId() : undefined;
    rewrites.push({
      index: rv.index,
      text: rv.text,
      ...(variantId && { slotVariantId: variantId }),
      // G1: per-rewrite cost from the slotScope.getOwnSpent() delta around this call.
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

  // Phase 11.2: aggregated per-slot drop warn — emit once per slot if any rewrites dropped,
  // with counts grouped by dropReason. Avoids per-rewrite log spam at high K.
  const droppedRewrites = rewrites.filter((r) => r.status === 'dropped');
  if (droppedRewrites.length > 0) {
    const reasonCounts: Record<string, number> = {};
    for (const r of droppedRewrites) {
      const reason = r.dropReason ?? 'unknown';
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
    slotLogger.warn?.('paragraph_recombine: rewrites dropped', {
      slotIndex: slot.paragraphIndex,
      droppedCount: droppedRewrites.length,
      totalCount: rewrites.length,
      reasonCounts,
    });
  }

  // ─── Self-abort check between rewrite and ranking (D16) ──────────
  if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION * perSlotBudgetUsd) {
    // Phase 11: surface slot discards.
    slotLogger.warn?.('paragraph_recombine: slot discarded', {
      slotIndex: slot.paragraphIndex,
      failurePoint: 'slot_budget',
      spentUsd: slotScope.getOwnSpent!(),
      perSlotBudgetUsd,
    });
    slotDetails.push({
      slotIndex: slot.paragraphIndex,
      originalText: slot.originalText,
      originalSlotVariantId,
      slotTopicId: topicId,
      perSlotBudgetUsd,
      spentUsd: slotScope.getOwnSpent!(),
      rewrites,
      discardReason: { failurePoint: 'slot_budget' },
    });
    return;
  }

  if (survivingRewriteVariants.length === 0) {
    // Phase 11: surface slot discards.
    slotLogger.warn?.('paragraph_recombine: slot discarded', {
      slotIndex: slot.paragraphIndex,
      failurePoint: 'no_valid_rewrites',
      totalAttempts: rewrites.length,
    });
    slotDetails.push({
      slotIndex: slot.paragraphIndex,
      originalText: slot.originalText,
      originalSlotVariantId,
      slotTopicId: topicId,
      perSlotBudgetUsd,
      spentUsd: slotScope.getOwnSpent!(),
      rewrites,
      discardReason: { failurePoint: 'no_valid_rewrites' },
    });
    return;
  }

  // ─── Sequential per-slot ranking (D18) ───────────────────────────
  // rankNewVariant MUTATES localPool/localRatings/etc. in place; calling in parallel
  // would corrupt the per-slot maps. Sequential is required.
  const slotConfig = ctx.config; // reuse run-level config (judge model + maxComparisonsPerVariant)
  // Override maxComparisonsPerVariant for the per-slot ranking (D9), and select the
  // paragraph-level comparison prompt (B1, investigate_matchmaking_paragraph_recombine_20260528)
  // so the judge evaluates single paragraphs with paragraph-appropriate criteria. Article-level
  // ranking (Step 6) keeps ctx.config unmodified → 'article' mode.
  // Article rubric is stripped at slot level (article-shaped dimensions like "structure"
  // don't apply at single-paragraph scale). investigate_sequential_paragraph_recombine_
  // performance_20260615 Phase 1d (Fix 5b): if the strategy configured a
  // paragraphJudgeRubric, attach it here so the slot judge uses paragraph-shaped
  // dimensions instead of the hardcoded paragraph rubric. Undefined → hardcoded.
  // See structured_judging_evolution_20260610 for the original strip rationale.
  const { judgeRubric: _droppedRubric, ...slotConfigNoRubric } = slotConfig;
  const perSlotConfig = {
    ...slotConfigNoRubric,
    judgeRubric: slotConfig.paragraphJudgeRubric,
    maxComparisonsPerVariant: maxComparisonsPerParagraph,
    comparisonMode: 'paragraph' as const,
  };
  const slotMatches: import('../../../pipeline/infra/types').V2Match[] = [];
  // Phase 9 retrofit R3: ranking calls inside this slot's loop get a
  // 'slot.N.ranking' subagent_name path.
  const rankingLogger = slotLogger.child?.('ranking') ?? slotLogger;
  // Phase 9 cost-attribution fix: rankNewVariant → rankSingleVariant issues LLM
  // calls under the shared 'ranking' label. Relabel them to 'paragraph_rank' via a
  // thin proxy so per-slot ranking spend buckets into paragraph_recombine_cost
  // (the shared 'ranking' label maps to ranking_cost — would pollute article ranking).
  const toRankLabel = (label: string): 'paragraph_rank' | typeof label =>
    label === 'ranking' ? 'paragraph_rank' : label;
  const rankLlm: EvolutionLLMClient = {
    complete: (prompt, label, options) =>
      slotLlm.complete(prompt, toRankLabel(label) as typeof label, options),
    completeStructured: (prompt, schema, schemaName, label, options) =>
      slotLlm.completeStructured(prompt, schema, schemaName, toRankLabel(label) as typeof label, options),
  };
  // G2 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): snapshot
  // the per-slot paragraph_rank phase total before the ranking loop so we can record
  // ranking.cost as a deltatized accounting of just THIS slot's ranking spend.
  const phasesBeforeRanking = slotScope.getPhaseCosts();
  const rankBefore = phasesBeforeRanking['paragraph_rank'] ?? 0;
  let rankingStatus: 'completed' | 'self_aborted' | 'skipped_insufficient_pool' = 'completed';
  for (const candidate of survivingRewriteVariants) {
    try {
      // Snapshot before ratings for the candidate's comparisons.
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
      });
      // Build beforeAfterRatings map entries from this rank's matches.
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
      // Rank failure for this candidate is non-fatal — other candidates may still rank.
    }

    // Self-abort check between rank cycles.
    if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION * perSlotBudgetUsd) {
      rankingStatus = 'self_aborted';
      break;
    }
  }
  // G2: capture per-slot ranking cost via the paragraph_rank phase delta.
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
    // No-rated-candidates path: stays with original.
  }

  // Determine winner text for the recombined article.
  const winnerVariant = localPool.find((v) => v.id === winnerSlotVariantId);
  if (winnerVariant) {
    slotWinnerTexts.set(slot.paragraphIndex, winnerVariant.text);
  }

  // ─── Arena sync (variants only) + per-slot match persistence ─────
  try {
    // syncToArena first (per iter-3 plan review — avoid orphan-match window).
    await syncToArena(
      ctx.runId,
      topicId,
      localPool.filter((v) => survivingRewriteVariants.some((s) => s.id === v.id)), // Only new rewrites; arena entries already exist.
      localRatings,
      // matchHistory drives syncToArena's per-variant arena_match_count tally so the slot
      // leaderboard shows real match counts (not 0). The RPC's p_matches is deprecated/ignored,
      // so comparison ROWS are still written solely by persistSlotMatches below — no double-write.
      slotMatches,
      ctx.db,
      false, // isSeeded
      slotLogger, // Phase 9 R3: slot.N subagent path on persistence logs
    );
  } catch (err) {
    // syncToArena failed: fall back to original, skip persistSlotMatches.
    // Phase 11: surface slot discards.
    slotLogger.warn?.('paragraph_recombine: slot discarded', {
      slotIndex: slot.paragraphIndex,
      failurePoint: 'sync_failed',
      message: err instanceof Error ? err.message : String(err),
    });
    slotDetails.push({
      slotIndex: slot.paragraphIndex,
      originalText: slot.originalText,
      originalSlotVariantId,
      slotTopicId: topicId,
      perSlotBudgetUsd,
      spentUsd: slotScope.getOwnSpent!(),
      rewrites,
      discardReason: { failurePoint: 'sync_failed', message: err instanceof Error ? err.message : String(err) },
    });
    slotWinnerTexts.set(slot.paragraphIndex, slot.originalText);
    return;
  }

  // Persist per-slot matches with the slot's prompt_id (per D10).
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

  // ─── Record slot detail ──────────────────────────────────────────
  slotDetails.push({
    slotIndex: slot.paragraphIndex,
    originalText: slot.originalText,
    originalSlotVariantId,
    slotTopicId: topicId,
    perSlotBudgetUsd,
    spentUsd: slotScope.getOwnSpent!(),
    rewrites,
    ranking: {
      matchCount: slotMatches.length,
      // G2: per-slot ranking cost from the paragraph_rank phase delta + status.
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
  });
}

// ─── Helpers ──────────────────────────────────────────────────────

function extractH1(text: string): string {
  const m = text.match(/^#\s+(.+?)\s*$/m);
  return m?.[1] ?? '';
}

function generateVariantId(): string {
  // Use crypto.randomUUID for variant IDs (matches existing patterns elsewhere in the codebase).
  return globalThis.crypto.randomUUID();
}

async function safeUpdateInvocation(_ctx: AgentContext, _detail: SlotRecombineExecutionDetail): Promise<void> {
  // No-op: Agent.run()'s template method calls updateInvocation at the end with the
  // detail returned from execute(). Per I3 (partial-detail-on-throw) we'd want to write
  // partial detail before re-throwing, but our execute() catches sub-step failures and
  // returns gracefully — Agent.run() handles the final write.
}

// Side-effect: register the attribution-dimension extractor at module load.
registerAttributionExtractor('paragraph_recombine', (_detail) => 'paragraph_recombine');
