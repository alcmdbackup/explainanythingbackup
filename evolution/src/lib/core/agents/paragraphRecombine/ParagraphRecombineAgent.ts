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
import { updateInvocation } from '../../../pipeline/infra/trackInvocations';
import { createEvolutionLLMClient } from '../../../pipeline/infra/createEvolutionLLMClient';
import { extractParagraphsWithRanges, validateParagraphRewrite, assembleRecombinedArticle } from '../../../shared/paragraphSlots';
import { rankNewVariant } from '../../../pipeline/loop/rankNewVariant';
import { loadArenaEntries } from '../../../pipeline/setup/buildRunContext';
import { selectWinner, type WinnerCandidate } from '../../../shared/selectWinner';
import { createRating, type Rating, type ComparisonResult } from '../../../shared/computeRatings';
import { syncToArena } from '../../../pipeline/finalize/persistRunResults';
import { validateFormat } from '../../../shared/enforceVariantFormat';
import {
  upsertSlotTopic,
  persistSlotMatches,
  makeMatchKey,
  type BeforeAfterRatingsMap,
} from '../../../../services/slotTopicActions';
import { buildParagraphRewritePrompt } from './buildParagraphRewritePrompt';

// ─── Defaults (per D9) ────────────────────────────────────────────

const DEFAULT_REWRITES_PER_PARAGRAPH = 3;
const DEFAULT_MAX_COMPARISONS_PER_PARAGRAPH = 6;
const DEFAULT_MAX_PARAGRAPHS_PER_INVOCATION = 12;
const DEFAULT_PER_INVOCATION_CAP_USD = 0.4;
const PRE_FINAL_RANKING_GATE_FRACTION = 0.9;
const SLOT_SELF_ABORT_FRACTION = 0.9;

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
  /** Match buffer (always empty for paragraph_recombine — per-slot matches are persisted
   *  inline by persistSlotMatches and do NOT flow through MergeRatingsAgent's bulk-merge
   *  at iteration end. This field exists for dispatch-loop type compatibility only). */
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
    const {
      parentText,
      parentVariantId,
      rewritesPerParagraph = DEFAULT_REWRITES_PER_PARAGRAPH,
      maxComparisonsPerParagraph = DEFAULT_MAX_COMPARISONS_PER_PARAGRAPH,
      maxParagraphsPerInvocation = DEFAULT_MAX_PARAGRAPHS_PER_INVOCATION,
      perInvocationCapUsd = DEFAULT_PER_INVOCATION_CAP_USD,
      llm,
    } = input;

    if (!llm) {
      throw new Error('ParagraphRecombineAgent: input.llm is required (Agent.run() should inject it)');
    }

    const invocationScope = ctx.costTracker as AgentCostScope;
    if (typeof invocationScope.getOwnSpent !== 'function') {
      throw new Error('ParagraphRecombineAgent: ctx.costTracker must be an AgentCostScope (B012)');
    }

    // ─── Step 1: Decompose ─────────────────────────────────────────
    const allSlots = extractParagraphsWithRanges(parentText);
    const slots = allSlots.slice(0, maxParagraphsPerInvocation);
    const paragraphCount = slots.length;
    const perSlotBudgetUsd = paragraphCount > 0 ? perInvocationCapUsd / paragraphCount : 0;

    // Extract H1 title from parent for the rewrite prompt's context.
    const parentH1 = extractH1(parentText);

    // Accumulator for execution_detail.slots[i] (populated in per-slot processing).
    const slotDetails: SlotRecombineExecutionDetail['slots'] = [];
    const slotWinnerTexts = new Map<number, string>();

    // ─── Step 2: Per-slot pipeline in parallel (D18) ───────────────
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

    // Sort slotDetails by slotIndex so the detail is deterministic.
    slotDetails.sort((a, b) => a.slotIndex - b.slotIndex);

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
    };

    if (!formatResult.valid) {
      // Persist partial detail before returning (I3).
      await safeUpdateInvocation(ctx, partialDetail);
      return {
        result: { variant: null, surfaced: false, status: 'generation_failed', matches: [] },
        detail: partialDetail,
      };
    }

    // ─── Step 4: Pre-final-ranking budget gate (D6/D9) ────────────
    if (invocationScope.getOwnSpent!() >= PRE_FINAL_RANKING_GATE_FRACTION * perInvocationCapUsd) {
      await safeUpdateInvocation(ctx, partialDetail);
      return {
        result: { variant: null, surfaced: false, status: 'generation_failed', matches: [] },
        detail: partialDetail,
      };
    }

    // ─── Step 5: Build the recombined Variant ─────────────────────
    // Per revised D4: parent_variant_ids = [parentVariant.id] only.
    // Slot winners live in execution_detail.slots[i].winnerSlotVariantId.
    const recombinedVariant = createVariant({
      text: recombinedText,
      tactic: 'paragraph_recombine',
      iterationBorn: ctx.iteration,
      parentIds: [parentVariantId],
      agentInvocationId: ctx.invocationId === '' ? undefined : ctx.invocationId,
    });

    // ─── Step 6: Post-emit ranking (D6 — always-on) ───────────────
    // Skipped when there's no run pool to rank against (initial article-only iteration).
    // The orchestrator-supplied run pool isn't directly available here; the dispatch
    // loop's MergeRatingsAgent path is what integrates this variant into the run pool.
    // Per the plan: post-emit ranking flows through MergeRatingsAgent at iteration end
    // with iterationType='paragraph_recombine' (added to the enum in Phase 1).

    // Finalize execution_detail and persist.
    const finalDetail: SlotRecombineExecutionDetail = {
      ...partialDetail,
      totalCost: invocationScope.getOwnSpent!(),
    };
    await safeUpdateInvocation(ctx, finalDetail);

    return {
      result: { variant: recombinedVariant, surfaced: true, status: 'converged', matches: [] },
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
  // Build a per-slot LLM client bound to slotScope so per-paragraph_rewrite calls are
  // attributed to this slot's spend, not aggregated across slots.
  const slotLlm = ctx.rawProvider && ctx.defaultModel
    ? createEvolutionLLMClient(ctx.rawProvider, slotScope, ctx.defaultModel)
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
  const rewriteResults = await Promise.allSettled(
    Array.from({ length: rewritesPerParagraph }, async (_, index) => {
      // Self-abort check before each rewrite (D16).
      if (slotScope.getOwnSpent!() >= SLOT_SELF_ABORT_FRACTION * perSlotBudgetUsd) {
        return { index, skipped: true as const };
      }
      const prompt = buildParagraphRewritePrompt(parentH1, slot.originalText, slot.paragraphIndex, totalSlots);
      const tStart = Date.now();
      let text: string;
      try {
        text = await slotLlm.complete(prompt, 'paragraph_rewrite');
      } catch (err) {
        return { index, skipped: false as const, error: err instanceof Error ? err.message : String(err) };
      }
      const durationMs = Date.now() - tStart;
      const validation = validateParagraphRewrite(text, slot.originalText.length);
      return { index, skipped: false as const, text, durationMs, validation };
    }),
  );

  // Collect surviving rewrites + record per-rewrite details.
  const rewrites: SlotRecombineExecutionDetail['slots'][number]['rewrites'] = [];
  const survivingRewriteVariants: Variant[] = [];
  for (const r of rewriteResults) {
    if (r.status !== 'fulfilled') continue;
    const rv = r.value;
    if (rv.skipped) {
      continue; // skipped due to self-abort
    }
    if ('error' in rv) {
      rewrites.push({
        index: rv.index,
        text: '',
        costUsd: 0,
        formatValid: false,
      });
      continue;
    }
    const valid = rv.validation.valid;
    const variantId = valid ? generateVariantId() : undefined;
    rewrites.push({
      index: rv.index,
      text: rv.text,
      ...(variantId && { slotVariantId: variantId }),
      costUsd: 0, // Per-call cost is bundled in slotScope.getOwnSpent() at slot end.
      durationMs: rv.durationMs,
      formatValid: valid,
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

  // ─── Self-abort check between rewrite and ranking (D16) ──────────
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

  // ─── Sequential per-slot ranking (D18) ───────────────────────────
  // rankNewVariant MUTATES localPool/localRatings/etc. in place; calling in parallel
  // would corrupt the per-slot maps. Sequential is required.
  const slotConfig = ctx.config; // reuse run-level config (judge model + maxComparisonsPerVariant)
  // Override maxComparisonsPerVariant for the per-slot ranking (D9).
  const perSlotConfig = { ...slotConfig, maxComparisonsPerVariant: maxComparisonsPerParagraph };
  const slotMatches: import('../../../pipeline/infra/types').V2Match[] = [];
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
        llm: slotLlm,
        config: perSlotConfig,
        invocationId: ctx.invocationId,
        logger: ctx.logger,
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
      break;
    }
  }

  // ─── Pick winner ─────────────────────────────────────────────────
  const winnerCandidates: WinnerCandidate[] = localPool.map((v) => ({ id: v.id }));
  let winnerSlotVariantId = originalSlotVariantId;
  let winnerIsOriginal = true;
  let winnerSource: 'this_invocation' | 'prior_invocation' | 'original' = 'original';
  try {
    const winnerResult = selectWinner(winnerCandidates, localRatings);
    winnerSlotVariantId = winnerResult.winnerId;
    winnerIsOriginal = winnerSlotVariantId === originalSlotVariantId;
    const isThisInvocation = survivingRewriteVariants.some((v) => v.id === winnerSlotVariantId);
    winnerSource = winnerIsOriginal ? 'original' : (isThisInvocation ? 'this_invocation' : 'prior_invocation');
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
      [], // matchHistory: empty — sync_to_arena's p_matches is deprecated; we use persistSlotMatches.
      ctx.db,
      false, // isSeeded
      ctx.logger,
    );
  } catch (err) {
    // syncToArena failed: fall back to original, skip persistSlotMatches.
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
