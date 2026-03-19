// Budget hard caps and rating constants for the evolution pipeline.

// ─── Budget hard caps (failsafe) ─────────────────────────────────

/** Maximum budget per single evolution run ($1). Enforced at queue time and as runner-level failsafe. */
export const MAX_RUN_BUDGET_USD = 1.00;

/** Maximum total budget per experiment ($10). Enforced when adding runs. */
export const MAX_EXPERIMENT_BUDGET_USD = 10.00;

// ─── Rating constants ────────────────────────────────────────────

export const RATING_CONSTANTS = {
  /** Sigma threshold below which a rating is considered converged. */
  CONVERGENCE_SIGMA_THRESHOLD: 3.0,
} as const;
