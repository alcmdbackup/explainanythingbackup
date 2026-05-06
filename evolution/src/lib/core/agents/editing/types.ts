// Internal types for IterativeEditingAgent. The persisted execution_detail
// shape lives in evolution/src/lib/types.ts (IterativeEditingExecutionDetail);
// these types describe the agent's input/output contract + intermediate
// helper-call shapes.

import type { Variant } from '../../../types';
import type { Rating, ComparisonResult } from '../../../shared/computeRatings';
import type { V2Match } from '../../../pipeline/infra/types';
import type {
  EditingAtomicEdit,
  EditingGroup,
  EditingReviewDecision,
  EditingDriftRegion,
  EditingDroppedGroup,
  EditingCycle,
  IterativeEditingExecutionDetail,
  IterativeEditingRankingDetail,
  IterativeEditingRankingComparison,
  IterativeEditingStopReason,
} from '../../../types';

export type {
  EditingAtomicEdit,
  EditingGroup,
  EditingReviewDecision,
  EditingDriftRegion,
  EditingDroppedGroup,
  EditingCycle,
  IterativeEditingExecutionDetail,
  IterativeEditingRankingDetail,
  IterativeEditingRankingComparison,
  IterativeEditingStopReason,
};

/** Agent input — assigned by the Phase 3.3 dispatch branch. The full Variant
 *  is passed (not separate parentText + parentVariantId primitives) per the
 *  Phase 2.A.0 design rationale: the chained-cycle invariants and downstream UI
 *  benefit from typed access to all Variant fields.
 *
 *  Ranking-context fields (initialPool, initialRatings, initialMatchCounts, cache,
 *  parentVariantId) are OPTIONAL — when undefined, the agent's input-presence gate
 *  skips the post-cycle ranking step. Diverges from `GenerateFromPreviousInput`
 *  (where these are required) because GFPA always ranks; editing can be configured
 *  off via EDITING_RANK_ENABLED. The dispatch site at runIterationLoop.ts threads
 *  these only when ranking is enabled.
 *  add_ranking_iterative_editing_agent_evolution_20260502 Phase 1.3. */
export interface IterativeEditInput {
  parent: Variant;
  /** Per-invocation budget cap per Decisions §15. */
  perInvocationBudgetUsd: number;
  /** Ranking-context: deep-cloned pool snapshot at iteration start. */
  initialPool?: ReadonlyArray<Variant>;
  /** Ranking-context: deep-cloned ratings snapshot. */
  initialRatings?: ReadonlyMap<string, Rating>;
  /** Ranking-context: shallow-cloned match-count snapshot. */
  initialMatchCounts?: ReadonlyMap<string, number>;
  /** Ranking-context: shared comparison cache (per evolution run). */
  cache?: Map<string, ComparisonResult>;
  /** Ranking-context: the parent's variant ID. Redundant with parent.id but
   *  mirrors GenerateFromPreviousInput's contract for consistency. */
  parentVariantId?: string;
}

/** Agent output. Per Decisions §14, AT MOST one final variant is materialized
 *  per invocation; intermediates live only in execution_detail.cycles[i].childText.
 *
 *  `matches` is populated when ranking ran (Phase 4.2 collects this into the
 *  iteration's match buffer for MergeRatingsAgent). Empty array when ranking
 *  was skipped via the input-presence gate. */
export interface IterativeEditOutput {
  /** The final cycle's text materialized as a Variant, OR null when no cycle
   *  accepted edits / format-validity failed / drift aborted / etc. */
  finalVariant: Variant | null;
  /** True iff finalVariant !== null AND no error occurred AND ranking did not
   *  discard via budget+below-cutoff (D1: mirror GFPA's surface/discard policy). */
  surfaced: boolean;
  /** Per-comparison match records from the post-cycle ranking phase. Empty
   *  when ranking was skipped. Phase 4.2 collects these into the editing
   *  iteration's match buffer for MergeRatingsAgent. */
  matches: ReadonlyArray<V2Match>;
  /** Discard reason — populated only when surfaced=false due to ranking budget+cutoff
   *  (D1). Carried in-memory only; NOT persisted to execution_detail (matches GFPA
   *  pattern; v1.1 follow-up to persist). */
  discardReason?: { localElo: number; localTop15Cutoff: number };
}

// ─── Parser intermediate types ────────────────────────────────────

/** Result of parseProposedEdits — groups + recovered source + per-group drop reasons. */
export interface ParseResult {
  groups: EditingGroup[];
  /** The marked-up text with all CriticMarkup removed; for substitution kept as
   *  the deleted text. Used by the strip-markup drift checker. */
  recoveredSource: string;
  dropped: EditingDroppedGroup[];
}

/** Result of checkProposerDrift — match or first-mismatch position. */
export type DriftCheckResult =
  | { drift: false }
  | { drift: true; firstDiffOffset: number; sample: string; regions: EditingDriftRegion[] };

/** Result of recoverDrift. */
export interface RecoverDriftResult {
  outcome: 'recovered' | 'unrecoverable_residual' | 'unrecoverable_intentional' | 'skipped_major_drift';
  patchedMarkup?: string;
  regions: EditingDriftRegion[];
  classifications?: EditingDriftRegion[];
  costUsd: number;
}

/** Result of validateEditGroups — pre-Approver filter result. */
export interface ValidateResult {
  approverGroups: EditingGroup[];
  droppedPreApprover: EditingDroppedGroup[];
}

/** Result of applyAcceptedGroups. */
export interface ApplyResult {
  newText: string;
  appliedGroups: EditingGroup[];
  droppedPostApprover: EditingDroppedGroup[];
  formatValid: boolean;
}
