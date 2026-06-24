// paragraph_recombine_agent_with_coherence_pass_evolution_20260620.
//
// Sibling to ParagraphRecombineAgent. Forces the LEGACY PARALLEL rewrite path
// (no priorPicks, no nextContext, no coordinator, no sequential mode) and uses
// the isolated rewrite prompt + 3 directives (REORDER / TIGHTEN / RESTRUCTURE)
// with the per-directive temperature ladder.
//
// CURRENT IMPLEMENTATION STATUS:
//   Phase 3 (THIS COMMIT): per-slot pipeline + assembly + provenance ratio +
//     article-level ranking. The coherencePassEnabled=false path is fully
//     functional (which IS the A/B baseline arm).
//   Phase 4 (DEFERRED): coherence pass via runEditingCycle() extracted from
//     IterativeEditingAgent. When coherencePassEnabled=true and Phase 4 hasn't
//     landed yet, the agent emits the recombined article unchanged and records
//     `coherencePass: { skipped: 'phase_4_pending' }` for forensics.
//
// LOAD-BEARING INVARIANTS:
//   I1. Internal helpers use input.llm directly (no nested Agent.run()).
//   I3. On future runEditingCycle throw, helper returns partialCycleOnThrow;
//       this agent MUST push it into execution_detail.coherencePass.cycles[]
//       BEFORE re-throw (Phase 4 wiring).
//   D4. parent_variant_ids = [originalParent] only — slot winners live in
//       execution_detail.slots[i].winnerSlotVariantId.
//   D10. Per-slot match persistence via persistSlotMatches.
//   D16. Per-slot AgentCostScope; self-abort at 0.85× perSlotBudget.
//   D18. All N slots in parallel via Promise.allSettled; per-slot ranking
//        is SEQUENTIAL (rankNewVariant mutates local maps in place).

import { Agent } from '../../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from '../../types';
import { type Variant, type EvolutionLLMClient, createVariant } from '../../../types';
import {
  paragraphRecombineWithCoherencePassExecutionDetailSchema,
  type ParagraphRecombineWithCoherencePassExecutionDetail,
} from '../../../schemas';
import { registerAttributionExtractor } from '../../../metrics/attributionExtractors';
import { createAgentCostScope, type AgentCostScope } from '../../../pipeline/infra/trackBudget';
import { createEvolutionLLMClient } from '../../../pipeline/infra/createEvolutionLLMClient';
import {
  extractParagraphsWithRanges,
  validateParagraphRewrite,
  assembleRecombinedArticle,
} from '../../../shared/paragraphSlots';
import { rankNewVariant } from '../../../pipeline/loop/rankNewVariant';
import { loadArenaEntries } from '../../../pipeline/setup/buildRunContext';
import { selectWinner, type WinnerCandidate } from '../../../shared/selectWinner';
import { createRating, type Rating, type ComparisonResult } from '../../../shared/computeRatings';
import type { V2Match } from '../../../pipeline/infra/types';
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
import { getModelMaxTemperature } from '@/config/modelRegistry';
import { estimateParagraphRecombineCost } from '../../../pipeline/infra/estimateCosts';
import { sentenceVerbatimOverlap } from '../../../shared/sentenceOverlap';
import {
  buildIsolatedParagraphRewritePrompt,
  getIsolatedRewriteDirective,
  isolatedRewriteTemperature,
} from './buildIsolatedParagraphRewritePrompt';
import { slotProvenanceRatio, provenancePercentiles } from './slotProvenance';
import {
  buildCoherencePassProposerSystemPrompt,
  buildCoherencePassProposerUserPrompt,
} from './buildCoherencePassProposerPrompt';
import { runEditingCycle } from '../editing/runEditingCycle';

// ─── Defaults (mirroring ParagraphRecombineAgent per D9) ──────────

const DEFAULT_REWRITES_PER_PARAGRAPH = 3;
const DEFAULT_MAX_COMPARISONS_PER_PARAGRAPH = 6;
const DEFAULT_MAX_PARAGRAPHS_PER_INVOCATION = 12;
const DEFAULT_PER_INVOCATION_CAP_WITH_COHERENCE = 0.10;
const DEFAULT_PER_INVOCATION_CAP_WITHOUT_COHERENCE = 0.05;
const DEFAULT_COHERENCE_REWRITE_TEMP_FLOOR = 0.6;
const DEFAULT_COHERENCE_REWRITE_TEMP_CEILING = 1.0;
const DEFAULT_COHERENCE_PASS_ENABLED = true;
const PRE_COHERENCE_GATE_FRACTION = 0.85;
const SLOT_SELF_ABORT_FRACTION = 0.9;

// Per investigate_paragraph_recombine_coherence_pass_performance_20260623.
// New (aggressive) defaults: 10% growth headroom, 2 cycles.
// Legacy (kill-switched) defaults: 2% growth headroom, 1 cycle.
const DEFAULT_COHERENCE_PASS_LENGTH_CAP_RATIO = 1.10;
const DEFAULT_COHERENCE_PASS_MAX_CYCLES = 2;
const LEGACY_COHERENCE_PASS_LENGTH_CAP_RATIO = 1.02;
const LEGACY_COHERENCE_PASS_MAX_CYCLES = 1;

/** Resolve coherence-pass defaults with kill-switch support.
 *
 * Reads `process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2` PER INVOCATION
 * (not at module load) so an ops flip in Vercel env takes effect on the next
 * invocation without a deploy. Default behavior (env unset or 'true') uses
 * the new aggressive defaults. Set to 'false' to revert to legacy behavior
 * for all strategies that rely on defaults.
 *
 * Explicit per-strategy input fields ALWAYS override this — the helper only
 * decides what the DEFAULT is when input is undefined.
 */
export function resolveCoherencePassDefaults(): { lengthCapRatio: number; maxCycles: number } {
  if (process.env.EVOLUTION_COHERENCE_PASS_DEFAULTS_V2 === 'false') {
    return {
      lengthCapRatio: LEGACY_COHERENCE_PASS_LENGTH_CAP_RATIO,
      maxCycles: LEGACY_COHERENCE_PASS_MAX_CYCLES,
    };
  }
  return {
    lengthCapRatio: DEFAULT_COHERENCE_PASS_LENGTH_CAP_RATIO,
    maxCycles: DEFAULT_COHERENCE_PASS_MAX_CYCLES,
  };
}

// ─── Types ────────────────────────────────────────────────────────

export interface ParagraphRecombineWithCoherencePassInput {
  parentText: string;
  parentVariantId: string;
  rewritesPerParagraph?: number;
  maxComparisonsPerParagraph?: number;
  maxParagraphsPerInvocation?: number;
  perInvocationCapUsd?: number;
  coherencePassEnabled?: boolean;
  coherencePassProposerModel?: string;
  coherencePassApproverModel?: string;
  coherencePassRewriteTempFloor?: number;
  coherencePassRewriteTempCeiling?: number;
  /** Per investigate_paragraph_recombine_coherence_pass_performance_20260623 Phase 3.
   *  Per-cycle length cap for the coherence-pass propose/approve cycle. Range 1.0–2.0.
   *  Default resolved via resolveCoherencePassDefaults() (kill-switch aware). */
  coherencePassLengthCapRatio?: number;
  /** Per investigate_paragraph_recombine_coherence_pass_performance_20260623 Phase 4.
   *  Maximum number of propose-approve-apply cycles in the coherence pass. Range 1–5.
   *  Default resolved via resolveCoherencePassDefaults() (kill-switch aware). */
  coherencePassMaxCycles?: number;
  initialPool?: Variant[];
  initialRatings?: Map<string, Rating>;
  initialMatchCounts?: Map<string, number>;
  cache?: Map<string, ComparisonResult>;
  llm?: EvolutionLLMClient;
}

export interface ParagraphRecombineWithCoherencePassOutput {
  variant: Variant | null;
  surfaced: boolean;
  status: 'converged' | 'generation_failed';
  matches: V2Match[];
}

// ─── Agent class ──────────────────────────────────────────────────

export class ParagraphRecombineWithCoherencePassAgent extends Agent<
  ParagraphRecombineWithCoherencePassInput,
  ParagraphRecombineWithCoherencePassOutput,
  ParagraphRecombineWithCoherencePassExecutionDetail
> {
  readonly name = 'paragraph_recombine_with_coherence_pass';
  readonly executionDetailSchema = paragraphRecombineWithCoherencePassExecutionDetailSchema;
  readonly detailViewConfig: DetailFieldDef[] = []; // Phase 6 fills this in
  readonly usesLLM = true;

  override getAttributionDimension(
    _detail: ParagraphRecombineWithCoherencePassExecutionDetail,
  ): string | null {
    return 'paragraph_recombine_with_coherence_pass';
  }

  async execute(
    input: ParagraphRecombineWithCoherencePassInput,
    ctx: AgentContext,
  ): Promise<AgentOutput<ParagraphRecombineWithCoherencePassOutput, ParagraphRecombineWithCoherencePassExecutionDetail>> {
    const {
      parentText,
      parentVariantId,
      rewritesPerParagraph = DEFAULT_REWRITES_PER_PARAGRAPH,
      maxComparisonsPerParagraph = DEFAULT_MAX_COMPARISONS_PER_PARAGRAPH,
      maxParagraphsPerInvocation = DEFAULT_MAX_PARAGRAPHS_PER_INVOCATION,
      coherencePassEnabled = DEFAULT_COHERENCE_PASS_ENABLED,
      coherencePassRewriteTempFloor = DEFAULT_COHERENCE_REWRITE_TEMP_FLOOR,
      coherencePassRewriteTempCeiling = DEFAULT_COHERENCE_REWRITE_TEMP_CEILING,
      llm,
    } = input;

    // Conditional per-invocation cap: $0.10 with coherence enabled, $0.05 without.
    // Matches the normalizeIteration fold in findOrCreateStrategy.ts (so config_hash
    // dedup is consistent with runtime behavior).
    const effectiveCapUsd = input.perInvocationCapUsd
      ?? (coherencePassEnabled ? DEFAULT_PER_INVOCATION_CAP_WITH_COHERENCE : DEFAULT_PER_INVOCATION_CAP_WITHOUT_COHERENCE);

    if (!llm) {
      throw new Error('ParagraphRecombineWithCoherencePassAgent: input.llm is required (Agent.run() should inject it)');
    }

    const invocationScope = ctx.costTracker as AgentCostScope;
    if (typeof invocationScope.getOwnSpent !== 'function') {
      throw new Error('ParagraphRecombineWithCoherencePassAgent: ctx.costTracker must be an AgentCostScope');
    }

    // Per-invocation-scope baseline snapshot. Subtracted from end-of-execute phase costs
    // to compute THIS invocation's per-phase delta (vs. all prior multi-dispatch siblings'
    // accumulated spend in the shared run-cumulative accumulator).
    const phasesAtEntry = invocationScope.getPhaseCosts();

    // ─── Step 1: Decompose ─────────────────────────────────────────
    const allSlots = extractParagraphsWithRanges(parentText);
    const slots = allSlots.slice(0, maxParagraphsPerInvocation);
    const paragraphCount = slots.length;
    const perSlotBudgetUsd = paragraphCount > 0 ? effectiveCapUsd / paragraphCount : 0;

    const rewriteModel = ctx.defaultModel ?? 'gpt-4.1-nano';
    const judgeModel = ctx.config?.judgeModel ?? 'qwen-2.5-7b-instruct';
    const projection = estimateParagraphRecombineCost(
      parentText.length,
      paragraphCount,
      rewritesPerParagraph,
      maxComparisonsPerParagraph,
      rewriteModel,
      judgeModel,
      { sequentialEnabled: false }, // Always legacy parallel path
    );

    const parentH1 = extractH1(parentText);

    const slotDetails: ParagraphRecombineWithCoherencePassExecutionDetail['slots'] = [];
    const slotWinnerTexts = new Map<number, string>();

    // ─── Step 2: Per-slot pipeline in parallel (D18) ──────────────
    await Promise.allSettled(
      slots.map((slot) =>
        processSlot({
          slot,
          parentH1,
          totalSlots: paragraphCount,
          rewritesPerParagraph,
          maxComparisonsPerParagraph,
          perSlotBudgetUsd,
          invocationScope,
          ctx,
          llm,
          tempFloor: coherencePassRewriteTempFloor,
          tempCeiling: coherencePassRewriteTempCeiling,
          slotDetails,
          slotWinnerTexts,
        }),
      ),
    );

    // Sort slotDetails by slotIndex for deterministic output.
    slotDetails.sort((a, b) => a.slotIndex - b.slotIndex);

    // ─── Per-phase actuals (delta vs invocation entry) ────────────
    const phasesAfter = invocationScope.getPhaseCosts();
    const actualRewriteCost = (phasesAfter['paragraph_rewrite'] ?? 0) - (phasesAtEntry['paragraph_rewrite'] ?? 0);
    const actualRankCost = (phasesAfter['paragraph_rank'] ?? 0) - (phasesAtEntry['paragraph_rank'] ?? 0);
    const pctError = (actual: number, est: number): number | undefined => {
      if (est <= 0 || !Number.isFinite(actual) || !Number.isFinite(est)) return undefined;
      return ((actual - est) / est) * 100;
    };
    const paragraphRewriteErrorPct = pctError(actualRewriteCost, projection.perPhase.paragraphRewriteCost);
    const paragraphRankErrorPct = pctError(actualRankCost, projection.perPhase.paragraphRankCost);

    // Run-level paragraph_recombine_cost = sum of per-slot rewrite + ranking phase
    // accumulators (mirrors ParagraphRecombineAgent's pattern).
    if (ctx.db && ctx.runId) {
      const paragraphCost = (phasesAfter['paragraph_rewrite'] ?? 0) + (phasesAfter['paragraph_rank'] ?? 0);
      try {
        await writeMetricMax(ctx.db, 'run', ctx.runId, 'paragraph_recombine_cost' as MetricName, paragraphCost, 'during_execution');
      } catch (err) {
        ctx.logger.warn?.('paragraph_recombine_cost write failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // ─── Step 3: Assemble + validate format ───────────────────────
    const recombinedText = assembleRecombinedArticle(parentText, slots, slotWinnerTexts);
    const formatResult = validateFormat(recombinedText);

    // ─── Run-level slot_provenance_ratio_p25/p50 ──────────────────
    // OBSERVATIONAL ONLY — see slotProvenance.ts noise caveat. Sentence-level matching
    // is reliable for TIGHTEN but noisy for REORDER and RESTRUCTURE.
    const provenanceRatios: number[] = [];
    for (const sd of slotDetails) {
      for (const rw of sd.rewrites) {
        if (rw.provenanceRatio !== undefined) provenanceRatios.push(rw.provenanceRatio);
      }
    }
    const provPercentiles = provenancePercentiles(provenanceRatios);
    if (ctx.db && ctx.runId && provPercentiles.n > 0) {
      try {
        await writeMetricMax(ctx.db, 'run', ctx.runId, 'slot_provenance_ratio_p25' as MetricName, provPercentiles.p25, 'at_finalization');
        await writeMetricMax(ctx.db, 'run', ctx.runId, 'slot_provenance_ratio_p50' as MetricName, provPercentiles.p50, 'at_finalization');
      } catch (err) {
        ctx.logger.warn?.('slot_provenance metric write failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Build base execution_detail (slot side complete; coherencePass populated below).
    const baseDetail: ParagraphRecombineWithCoherencePassExecutionDetail = {
      detailType: 'paragraph_recombine_with_coherence_pass',
      parentVariantId,
      slots: slotDetails,
      recombined: {
        text: recombinedText,
        formatValid: formatResult.valid,
        ...(formatResult.issues.length > 0 && { formatIssues: formatResult.issues }),
      },
      totalCost: invocationScope.getOwnSpent!(),
      estimatedTotalCost: projection.expected,
      estimatedTotalCostUpperBound: projection.upperBound,
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
    };

    // ─── Step 4: Format-invalid recombine → fail ──────────────────
    if (!formatResult.valid) {
      // Truncate intermediate text to 8KB per Q6 contract.
      const detail: ParagraphRecombineWithCoherencePassExecutionDetail = {
        ...baseDetail,
        recombinedBeforeCoherencePass: recombinedText.slice(0, 8 * 1024),
        coherencePass: { skipped: 'format_invalid_recombine' },
      };
      return {
        result: { variant: null, surfaced: false, status: 'generation_failed', matches: [] },
        detail,
        failure: { code: 'format_invalid', message: 'recombined article failed format validation' },
      };
    }

    // ─── Step 5: Coherence pass (Phase 4 lands the real implementation) ───
    let finalText = recombinedText;
    const recombinedBeforeCoherencePass = recombinedText.slice(0, 8 * 1024);
    type CoherencePassDetail = ParagraphRecombineWithCoherencePassExecutionDetail['coherencePass'];
    let coherencePass: CoherencePassDetail;

    if (!coherencePassEnabled) {
      coherencePass = { skipped: 'disabled' };
    } else if (invocationScope.getOwnSpent!() >= PRE_COHERENCE_GATE_FRACTION * effectiveCapUsd) {
      coherencePass = {
        skipped: 'budget',
        spentAtSkip: invocationScope.getOwnSpent!(),
        capUsd: effectiveCapUsd,
      };
    } else {
      // Per investigate_paragraph_recombine_coherence_pass_performance_20260623:
      // - Phase 1: proposer prompt rewritten for voice-restoration scope.
      // - Phase 2a: redundancyJaccardThreshold + flowGuardrailEnabled dropped from
      //   validateOpts; lengthCapRatio is the only validator-side constraint.
      // - Phase 3: lengthCapRatio is now an iter-config field (input.coherencePassLengthCapRatio)
      //   with kill-switch-aware default via resolveCoherencePassDefaults().
      // - Phase 4: single cycle replaced with a bounded loop (input.coherencePassMaxCycles,
      //   default via the same kill switch). Per-cycle proposerUserPrompt is rebuilt from
      //   the running text — cycle 2+ MUST see the post-cycle-1 article as <source>,
      //   otherwise parseProposedEdits' RULE-1 outside-markup-fidelity check drops every
      //   group. driftRecovery: 'skip' (the assembled article is the source of truth).
      //   Mode A only — no rewriteMode passed, so coalesceAdjacentGroups +
      //   capGroupsByMagnitude are skipped (intentional: no edit-count cap).
      const proposerModel = input.coherencePassProposerModel ?? rewriteModel;
      const approverModel = input.coherencePassApproverModel ?? judgeModel;
      const coherenceLogger = ctx.logger.child?.('coherence_pass') ?? ctx.logger;
      const killSwitchDefaults = resolveCoherencePassDefaults();
      const effectiveLengthCapRatio = input.coherencePassLengthCapRatio ?? killSwitchDefaults.lengthCapRatio;
      const maxCycles = input.coherencePassMaxCycles ?? killSwitchDefaults.maxCycles;

      const cycles = [];
      let currentText = recombinedText;
      let silentRejectionCount = 0;

      for (let cycleNumber = 1; cycleNumber <= maxCycles; cycleNumber++) {
        const cycleResult = await runEditingCycle({
          text: currentText,
          llm,
          costScope: invocationScope,
          perInvocationBudgetUsd: effectiveCapUsd,
          cycleNumber,
          proposerLabel: 'coherence_pass_propose',
          approverLabel: 'coherence_pass_review',
          models: { editing: proposerModel, approver: approverModel },
          validateOpts: { lengthCapRatio: effectiveLengthCapRatio },
          driftRecovery: 'skip',
          proposerSystemPrompt: buildCoherencePassProposerSystemPrompt(),
          // CRITICAL: rebuild the user prompt from currentText each iteration.
          // If we pinned the cycle-1 recombined text, cycle 2's proposer would
          // emit CriticMarkup against the STALE <source> and parseProposedEdits
          // (which validates against currentText) would drop most groups via
          // RULE 1 (outside-markup fidelity).
          proposerUserPrompt: buildCoherencePassProposerUserPrompt(currentText),
        });

        cycles.push(cycleResult.cycle);

        // Per-cycle silent-rejection: accumulated count, single writeMetricMax at end.
        const silentThisCycle =
          cycleResult.cycle.approverGroups.length > 0
          && cycleResult.cycle.appliedGroups.length === 0;
        if (silentThisCycle) silentRejectionCount += 1;

        currentText = cycleResult.newText;

        // Per runEditingCycle.ts:549, every appliedAny:false path sets a stopReason.
        // So stopReason subsumes appliedAny; this is the tighter termination check.
        if (cycleResult.stopReason) break;
      }
      finalText = currentText;

      if (silentRejectionCount > 0) {
        coherenceLogger.warn?.('coherence pass had silent-rejection cycles', {
          phaseName: 'paragraph_recombine_with_coherence_pass',
          silentRejectionCount,
        });
        if (ctx.db && ctx.runId) {
          try {
            await writeMetricMax(ctx.db, 'run', ctx.runId, 'coherence_pass_silent_rejection_count' as MetricName, silentRejectionCount, 'during_execution');
          } catch { /* non-fatal */ }
        }
      }

      coherencePass = {
        cycles,
        config: {
          proposerModel,
          approverModel,
          lengthCapRatio: effectiveLengthCapRatio,
        },
        ...(silentRejectionCount > 0 && { silentRejection: true }),
      };

      // Run-level cost rollup for the coherence-pass umbrella.
      if (ctx.db && ctx.runId) {
        const phases = invocationScope.getPhaseCosts();
        const coherenceCost = (phases['coherence_pass_propose'] ?? 0) + (phases['coherence_pass_review'] ?? 0);
        try {
          await writeMetricMax(ctx.db, 'run', ctx.runId, 'paragraph_recombine_coherence_cost' as MetricName, coherenceCost, 'during_execution');
        } catch (err) {
          ctx.logger.warn?.('paragraph_recombine_coherence_cost write failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    // ─── Step 6: Build the recombined Variant ─────────────────────
    // Compute sentence_verbatim_ratio (universal metric, parent → child direction).
    let sentenceVerbatimRatio: number | undefined;
    try {
      sentenceVerbatimRatio = sentenceVerbatimOverlap(parentText, finalText).ratio;
    } catch (err) {
      ctx.logger.warn?.('sentence-overlap compute failed; ratio stays NULL', {
        phaseName: 'paragraph_recombine_with_coherence_pass',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const recombinedVariant = createVariant({
      text: finalText,
      tactic: 'paragraph_recombine_with_coherence_pass',
      iterationBorn: ctx.iteration,
      parentIds: [parentVariantId],
      agentInvocationId: ctx.invocationId === '' ? undefined : ctx.invocationId,
      ...(sentenceVerbatimRatio !== undefined && { sentenceVerbatimRatio }),
    });

    // ─── Step 7: Article-level ranking ────────────────────────────
    let articleMatches: V2Match[] = [];
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

    const finalDetail: ParagraphRecombineWithCoherencePassExecutionDetail = {
      ...baseDetail,
      recombinedBeforeCoherencePass,
      ...(coherencePass && { coherencePass }),
      totalCost: invocationScope.getOwnSpent!(),
    };

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
  parentH1: string;
  totalSlots: number;
  rewritesPerParagraph: number;
  maxComparisonsPerParagraph: number;
  perSlotBudgetUsd: number;
  invocationScope: AgentCostScope;
  ctx: AgentContext;
  llm: EvolutionLLMClient;
  tempFloor: number;
  tempCeiling: number;
  slotDetails: ParagraphRecombineWithCoherencePassExecutionDetail['slots'];
  slotWinnerTexts: Map<number, string>;
}

async function processSlot(params: ProcessSlotParams): Promise<void> {
  const {
    slot, parentH1, totalSlots, rewritesPerParagraph, maxComparisonsPerParagraph,
    perSlotBudgetUsd, invocationScope, ctx, llm, tempFloor, tempCeiling, slotDetails, slotWinnerTexts,
  } = params;

  // Per-slot state isolation (D18).
  const localPool: Variant[] = [];
  const localRatings = new Map<string, Rating>();
  const localMatchCounts = new Map<string, number>();
  const completedPairs = new Set<string>();
  const cache = new Map<string, ComparisonResult>();
  const beforeAfterRatings: BeforeAfterRatingsMap = new Map();

  slotWinnerTexts.set(slot.paragraphIndex, slot.originalText);

  const slotScope = createAgentCostScope(invocationScope);
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

  // ─── Topic setup (D10) ─────────────────────────────────────────
  let topicId: string;
  let originalSlotVariantId: string;
  try {
    const upsert = await upsertSlotTopic(ctx.db, 'paragraph', `${slot.paragraphIndex}`, slot.paragraphIndex, slot.originalText);
    topicId = upsert.topicId;
    originalSlotVariantId = upsert.originalSlotVariantId;
  } catch (err) {
    slotLogger.warn?.('paragraph_recombine_with_coherence_pass: slot discarded', {
      slotIndex: slot.paragraphIndex,
      failurePoint: 'sync_failed',
      message: err instanceof Error ? err.message : String(err),
    });
    slotDetails.push({
      slotIndex: slot.paragraphIndex,
      originalText: slot.originalText,
      originalSlotVariantId: '00000000-0000-0000-0000-000000000000',
      slotTopicId: '00000000-0000-0000-0000-000000000000',
      perSlotBudgetUsd,
      spentUsd: slotScope.getOwnSpent!(),
      rewrites: [],
      discardReason: { failurePoint: 'sync_failed', message: err instanceof Error ? err.message : String(err) },
    });
    return;
  }

  // Seed local pool with the original-paragraph variant.
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

  // Load arena entries (top-20).
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

  // ─── M parallel rewrites (D18) — isolated prompt + directive ladder ───
  const rewriteMaxTemp = ctx.defaultModel ? getModelMaxTemperature(ctx.defaultModel) : undefined;
  const rewriteResults = await Promise.allSettled(
    Array.from({ length: rewritesPerParagraph }, async (_, index) => {
      if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION * perSlotBudgetUsd) {
        return { index, skipped: true as const, temperature: undefined as number | undefined };
      }
      const directive = getIsolatedRewriteDirective(index);
      const temperature = isolatedRewriteTemperature(index, tempFloor, tempCeiling, rewriteMaxTemp);
      const prompt = buildIsolatedParagraphRewritePrompt(parentH1, slot.originalText, slot.paragraphIndex, totalSlots, directive);
      const tStart = Date.now();
      const phasesBefore = slotScope.getPhaseCosts();
      const rewriteBefore = phasesBefore['paragraph_rewrite'] ?? 0;
      let text: string;
      try {
        text = await slotLlm.complete(prompt, 'paragraph_rewrite', temperature !== undefined ? { temperature } : undefined);
      } catch (err) {
        return { index, skipped: false as const, error: err instanceof Error ? err.message : String(err), temperature, directiveName: directive.name };
      }
      const phasesAfter = slotScope.getPhaseCosts();
      const rewriteAfter = phasesAfter['paragraph_rewrite'] ?? 0;
      const costUsd = Math.max(0, rewriteAfter - rewriteBefore);
      const durationMs = Date.now() - tStart;
      const validation = validateParagraphRewrite(text, slot.originalText.length);
      return { index, skipped: false as const, text, durationMs, validation, costUsd, temperature, directiveName: directive.name };
    }),
  );

  const rewrites: ParagraphRecombineWithCoherencePassExecutionDetail['slots'][number]['rewrites'] = [];
  const survivingRewriteVariants: Variant[] = [];
  for (const r of rewriteResults) {
    if (r.status !== 'fulfilled') continue;
    const rv = r.value;
    if (rv.skipped) {
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
        ...(rv.directiveName && { directive: rv.directiveName }),
        status: 'llm_error',
      });
      continue;
    }
    const valid = rv.validation.valid;
    const variantId = valid ? generateVariantId() : undefined;
    // Compute slot provenance (CHILD → PARENT direction; Q8 observational metric).
    let provenanceRatio: number | undefined;
    if (valid) {
      try {
        provenanceRatio = slotProvenanceRatio(slot.originalText, rv.text);
      } catch { /* non-fatal */ }
    }
    rewrites.push({
      index: rv.index,
      text: rv.text,
      ...(variantId && { slotVariantId: variantId }),
      costUsd: rv.costUsd,
      durationMs: rv.durationMs,
      ...(rv.temperature !== undefined && { temperature: rv.temperature }),
      ...(provenanceRatio !== undefined && { provenanceRatio }),
      ...(rv.directiveName && { directive: rv.directiveName }),
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

  // Self-abort check between rewrite and ranking (D16).
  if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION * perSlotBudgetUsd) {
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

  // ─── Sequential per-slot ranking (D18) ─────────────────────────
  const slotConfig = ctx.config;
  const { judgeRubric: _droppedRubric, ...slotConfigNoRubric } = slotConfig;
  const perSlotConfig = {
    ...slotConfigNoRubric,
    judgeRubric: slotConfig.paragraphJudgeRubric,
    maxComparisonsPerVariant: maxComparisonsPerParagraph,
    comparisonMode: 'paragraph' as const,
  };
  const slotMatches: V2Match[] = [];
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
      /* non-fatal per-candidate */
    }
    if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION * perSlotBudgetUsd) {
      rankingStatus = 'self_aborted';
      break;
    }
  }
  const phasesAfterRanking = slotScope.getPhaseCosts();
  const rankAfter = phasesAfterRanking['paragraph_rank'] ?? 0;
  const rankingCost = Math.max(0, rankAfter - rankBefore);

  // ─── Pick winner ───────────────────────────────────────────────
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
    /* no-rated-candidates → original */
  }

  const winnerVariant = localPool.find((v) => v.id === winnerSlotVariantId);
  if (winnerVariant) {
    slotWinnerTexts.set(slot.paragraphIndex, winnerVariant.text);
  }

  // ─── syncToArena + persistSlotMatches ─────────────────────────
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

  if (slotMatches.length > 0) {
    await persistSlotMatches(
      ctx.db, topicId, ctx.runId, ctx.invocationId, ctx.iteration,
      slotMatches, beforeAfterRatings,
    );
  }

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
      comparisonCount: slotMatches.length,
      cost: rankingCost,
      status: rankingStatus,
      ratings: Array.from(localRatings.entries()).map(([variantId, r]) => ({
        variantId, elo: r.elo, uncertainty: r.uncertainty,
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
  return globalThis.crypto.randomUUID();
}

// Side-effect: register the attribution-dimension extractor at module load.
registerAttributionExtractor(
  'paragraph_recombine_with_coherence_pass',
  (_detail) => 'paragraph_recombine_with_coherence_pass',
);
