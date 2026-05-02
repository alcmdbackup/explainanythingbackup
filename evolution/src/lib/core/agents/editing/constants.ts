// Module-level constants for IterativeEditingAgent and its helpers.
// Centralized here so per-test overrides don't require shotgun-edits across the
// agent + parser + validator + drift-recovery files.

export const AGENT_DEFAULT_MAX_CYCLES = 3;
export const AGENT_MAX_ATOMIC_EDITS_PER_CYCLE = 30;
export const AGENT_MAX_ATOMIC_EDITS_PER_GROUP = 5;

/** Per-cycle hard cap on size growth ratio (newText.length / current.text.length).
 *  Exceeding triggers group-dropping; un-droppable mega-insertions abort the cycle
 *  with stopReason: 'article_size_explosion'. Per Decisions §17. */
export const SIZE_RATIO_HARD_CAP = 1.5;

/** Drift-recovery magnitude classifier thresholds (per Decisions §11). Drift is
 *  "minor" if ALL hold: regions ≤ DRIFT_MAX_REGIONS, totalDriftedChars ≤
 *  DRIFT_MAX_CHARS, no region overlaps any markupRange. */
export const DRIFT_MAX_REGIONS = 3;
export const DRIFT_MAX_CHARS = 200;

/** Context-string failsafe length per side of each atomic edit.
 *  range.start - CONTEXT_LEN .. range.start (before) and
 *  range.end .. range.end + CONTEXT_LEN (after). */
export const CONTEXT_LEN = 30;

/** Per Decisions §15 — agent self-aborts when its own scope spend reaches
 *  PER_INVOCATION_BUDGET_ABORT_FRACTION of perInvocationBudgetUsd. */
export const PER_INVOCATION_BUDGET_ABORT_FRACTION = 0.9;

/** Soft per-edit length caps. */
export const EDIT_NEWTEXT_LENGTH_CAP = 500;
