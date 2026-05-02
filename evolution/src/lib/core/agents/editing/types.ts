// Internal types for IterativeEditingAgent. The persisted execution_detail
// shape lives in evolution/src/lib/types.ts (IterativeEditingExecutionDetail);
// these types describe the agent's input/output contract + intermediate
// helper-call shapes.

import type { Variant } from '../../../types';
import type {
  EditingAtomicEdit,
  EditingGroup,
  EditingReviewDecision,
  EditingDriftRegion,
  EditingDroppedGroup,
  EditingCycle,
  IterativeEditingExecutionDetail,
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
  IterativeEditingStopReason,
};

/** Agent input — assigned by the Phase 3.3 dispatch branch. The full Variant
 *  is passed (not separate parentText + parentVariantId primitives) per the
 *  Phase 2.A.0 design rationale: the chained-cycle invariants and downstream UI
 *  benefit from typed access to all Variant fields. */
export interface IterativeEditInput {
  parent: Variant;
  /** Per-invocation budget cap per Decisions §15. */
  perInvocationBudgetUsd: number;
}

/** Agent output. Per Decisions §14, AT MOST one final variant is materialized
 *  per invocation; intermediates live only in execution_detail.cycles[i].childText. */
export interface IterativeEditOutput {
  /** The final cycle's text materialized as a Variant, OR null when no cycle
   *  accepted edits / format-validity failed / drift aborted / etc. */
  finalVariant: Variant | null;
  /** True iff finalVariant !== null AND no error occurred. Mirrors GFPA's surfaced flow. */
  surfaced: boolean;
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
