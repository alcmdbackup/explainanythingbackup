// Shared types for the weight-inference stats core: pairwise verdict observations,
// the fitted-weight result shape, and the per-criterion CI shape. Data-source-agnostic
// (human and LLM verdicts produce the same PairObservation rows).

/** Lowercase A/B/TIE verdict, matching the DB CHECK enum. */
export type Verdict3 = 'a' | 'b' | 'tie';

/**
 * One labelled pair for the fit: the overall verdict (label) + a per-criterion
 * verdict (features), both canonical-oriented (relative to article_a vs article_b).
 * `confidence` ∈ [0,1] weights the pair in the fit (default 1); it comes from the
 * reversal-audit agreement (human) or the reconciled 2-pass confidence (LLM).
 */
export interface PairObservation {
  overall: Verdict3;
  /** criteriaId -> verdict on that criterion */
  dims: Record<string, Verdict3>;
  confidence?: number;
}

/** A single inferred rubric weight (normalized: non-negative, weights sum to 1). */
export interface CriterionWeight {
  criteriaId: string;
  weight: number;
}

export interface WeightFitFlags {
  /** Normalized weight below the "barely matters" threshold. */
  barelyMatters: string[];
  /** Raw logistic coefficient was negative pre-clamp (criterion opposes the overall). */
  disagreesWithOverall: string[];
  /** Zero-variance / constant column — non-identifiable, pinned to weight 0. */
  nonIdentifiable: string[];
  /** Criteria pairs whose verdicts move together (can't be separated). */
  collinear: Array<[string, string]>;
}

export interface WeightFitResult {
  weights: CriterionWeight[];
  /** Fraction of fitted pairs whose weighted vote matches the overall verdict. */
  trainAccuracy: number;
  /** k-fold cross-validated accuracy when enough data; null otherwise. */
  heldOutAccuracy: number | null;
  /** Final (regularized) log-likelihood of the full fit. */
  logLik: number;
  /** Number of pairs that entered the fit (non-tie overall + complete dims). */
  nPairs: number;
  flags: WeightFitFlags;
  /** True when too few usable pairs / all-tie / no signal — weights are unreliable. */
  degenerate: boolean;
}

/** Per-criterion weight with a bootstrap 95% CI. */
export interface WeightCI {
  criteriaId: string;
  value: number;
  ciLow: number;
  ciHigh: number;
  n: number;
}

/** Audit metric for one channel (overall, or a single criterion). */
export interface AuditMetric {
  /** Fraction of replicated pairs whose canonical verdict FLIPPED under reversal. */
  positionBiasRate: number;
  /** Fraction of replicated pairs whose canonical verdict AGREED across passes. */
  selfConsistencyRate: number;
  /** Number of replicated pairs compared. */
  n: number;
}

export interface ConsistencyAudit {
  overall: AuditMetric;
  /** criteriaId -> per-criterion audit metric */
  perCriterion: Record<string, AuditMetric>;
}

export interface RequiredRatings {
  /** Distinct pairs to judge for stable weights. */
  pairs: number;
  /** Total comparisons incl. the reversal-audit replicas. */
  comparisons: number;
  /** Total individual verdicts (overall + per-criterion) across all comparisons. */
  verdicts: number;
}
