// ParagraphRecombineAgent: decomposes a parent article into paragraphs, generates M rewrites
// per slot in parallel, ranks per slot via the existing Elo machinery, and recombines per-slot
// winners into one new article variant.
//
// Per the planning doc at docs/planning/rank_individual_paragraphs_evolution_20260525/. Stub
// shipped in Phase 1 for type compatibility with the dispatch wiring (Phase 5) and Zod schema
// union (Phase 1). The full execute() body is built in Phase 4.
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
//        pool/ratings/matchCounts in place).
//   D4.  parent_variant_ids = [originalParent] only — slot winners live in
//        execution_detail.slots[i].winnerSlotVariantId, NOT in parent_variant_ids.
//   D10. Per-slot match persistence via persistSlotMatches (Phase 3 helper), NOT MergeRatingsAgent
//        (whose ctx.promptId would misroute to the article topic).

import { Agent } from '../../Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from '../../types';
import type { Variant } from '../../../types';
import { slotRecombineExecutionDetailSchema, type SlotRecombineExecutionDetail } from '../../../schemas';
import { registerAttributionExtractor } from '../../../metrics/attributionExtractors';

/** Input to ParagraphRecombineAgent. Per Phase 4: the resolved parent variant is passed in,
 *  along with the iteration's per-slot caps. Full type extends in Phase 4. */
export interface ParagraphRecombineInput {
  parent: Variant;
  rewritesPerParagraph?: number;
  maxComparisonsPerParagraph?: number;
  maxParagraphsPerInvocation?: number;
  perInvocationCapUsd?: number;
}

/** Output: the single recombined variant (when surfaced) or null (when discarded). */
export interface ParagraphRecombineOutput {
  variant: Variant | null;
  surfaced: boolean;
}

export class ParagraphRecombineAgent extends Agent<
  ParagraphRecombineInput,
  ParagraphRecombineOutput,
  SlotRecombineExecutionDetail
> {
  readonly name = 'paragraph_recombine';
  readonly executionDetailSchema = slotRecombineExecutionDetailSchema;
  readonly detailViewConfig: DetailFieldDef[] = []; // Phase 6 fills this in.
  readonly usesLLM = true;

  /** Attribution dimension is a static marker tactic per D19 — variants from this agent
   *  bucket under `eloAttrDelta:paragraph_recombine:paragraph_recombine` for cross-strategy
   *  comparison on the tactic leaderboard. */
  override getAttributionDimension(_detail: SlotRecombineExecutionDetail): string | null {
    return 'paragraph_recombine';
  }

  async execute(
    _input: ParagraphRecombineInput,
    _ctx: AgentContext,
  ): Promise<AgentOutput<ParagraphRecombineOutput, SlotRecombineExecutionDetail>> {
    // Phase 4 implements the full execute() body. Phase 1 stub throws so the dispatch wiring
    // can compile against the typed contract without running paragraph_recombine end-to-end.
    throw new Error(
      'ParagraphRecombineAgent.execute is not yet implemented. See Phase 4 of ' +
        'docs/planning/rank_individual_paragraphs_evolution_20260525/.',
    );
  }
}

// Side-effect: register the attribution-dimension extractor at module load. Per the existing
// pattern in reflectAndGenerateFromPreviousArticle.ts and other agent files. Importing the
// barrel evolution/src/lib/core/agents/index.ts pulls this in so the metrics-layer
// ATTRIBUTION_EXTRACTORS registry has the entry by the time computeEloAttributionMetrics runs.
registerAttributionExtractor('paragraph_recombine', (_detail) => 'paragraph_recombine');
