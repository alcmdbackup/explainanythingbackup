// paragraph_recombine_agent_with_coherence_pass_evolution_20260620.
//
// Slot-level provenance ratio: fraction of CHILD sentences appearing (verbatim or
// near-verbatim via Levenshtein <= 2) in PARENT. Asymmetric to the existing
// `sentenceVerbatimRatio` (which is parent → child).
//
// Q8 from /research — OBSERVATIONAL ONLY.
//
// **NOISE CAVEAT** (must be reflected in metrics.md + UI tooltip):
//   Sentence-level matching is RELIABLE for the TIGHTEN directive (deleting whole
//   sentences leaves surviving child sentences intact, so they near-match parent).
//   It is NOISY for REORDER (word-reorderings within a sentence don't near-match)
//   and RESTRUCTURE (splits/combines change sentence boundaries — a child sentence
//   that's a combination of two parent sentences won't match either alone).
//
//   Low values do NOT necessarily indicate prompt violation. Use the metric as a
//   directional signal, not a hard compliance check. A true compliance check needs
//   an LLM judge ("does the child contain any factual claim not in parent?").

import { sentenceVerbatimOverlap } from '../../../shared/sentenceOverlap';

/** Compute the fraction of CHILD sentences appearing in PARENT (near-match tolerated).
 *  Range [0, 1]. Returns 1.0 when child has zero sentences (degenerate). */
export function slotProvenanceRatio(parentParagraph: string, childParagraph: string): number {
  // Swap args: sentenceVerbatimOverlap(P, C) returns fraction of P sentences in C.
  // We want fraction of C sentences in P — so swap.
  const result = sentenceVerbatimOverlap(childParagraph, parentParagraph);
  return result.ratio;
}

/** Compute percentiles over a list of provenance ratios. Used by the run-level
 *  `slot_provenance_ratio_p25` + `slot_provenance_ratio_p50` metrics. NaN-safe
 *  (drops non-finite values before sorting). */
export function provenancePercentiles(ratios: ReadonlyArray<number>): { p25: number; p50: number; n: number } {
  const finite = ratios.filter((r) => Number.isFinite(r));
  if (finite.length === 0) return { p25: 0, p50: 0, n: 0 };
  const sorted = [...finite].sort((a, b) => a - b);
  return {
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    n: sorted.length,
  };
}

function percentile(sortedAsc: ReadonlyArray<number>, q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = q * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}
