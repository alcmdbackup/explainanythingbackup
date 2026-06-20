// Reviewer-bias audit from reversal replicas: compares a pair's pass-0 and pass-1
// canonical-oriented verdicts to compute position-bias rate (verdict flipped under
// reversal) and self-consistency rate (verdict agreed) — for the overall verdict and
// per criterion. Human analogs of Judge Lab's LLM-judge metrics. Also derives the
// per-pair confidence the fit consumes.

import type { AuditMetric, ConsistencyAudit, PairObservation, Verdict3 } from './types';

/** A pair judged twice (original + reversal replica), both canonical-oriented. */
export interface ReplicatedPair {
  pass0: PairObservation;
  pass1: PairObservation;
}

const AGREE_CONFIDENCE = 1.0;
const DISAGREE_CONFIDENCE = 0.3;

function isDecisiveOpposite(a: Verdict3, b: Verdict3): boolean {
  return (a === 'a' && b === 'b') || (a === 'b' && b === 'a');
}

function metric(flips: number, agrees: number, n: number): AuditMetric {
  return {
    positionBiasRate: n > 0 ? flips / n : 0,
    selfConsistencyRate: n > 0 ? agrees / n : 0,
    n,
  };
}

/**
 * Compute the consistency audit over replicated pairs. Position bias = canonical
 * verdict flipped to the opposite decisive side under reversal; self-consistency =
 * canonical verdict agreed across passes.
 */
export function auditConsistency(replicas: ReplicatedPair[]): ConsistencyAudit {
  let overallFlips = 0;
  let overallAgrees = 0;
  const perCrit = new Map<string, { flips: number; agrees: number; n: number }>();

  for (const { pass0, pass1 } of replicas) {
    if (pass0.overall === pass1.overall) overallAgrees++;
    if (isDecisiveOpposite(pass0.overall, pass1.overall)) overallFlips++;

    const ids = new Set([...Object.keys(pass0.dims), ...Object.keys(pass1.dims)]);
    for (const id of ids) {
      const v0 = pass0.dims[id];
      const v1 = pass1.dims[id];
      if (v0 === undefined || v1 === undefined) continue;
      const cur = perCrit.get(id) ?? { flips: 0, agrees: 0, n: 0 };
      cur.n++;
      if (v0 === v1) cur.agrees++;
      if (isDecisiveOpposite(v0, v1)) cur.flips++;
      perCrit.set(id, cur);
    }
  }

  const n = replicas.length;
  const perCriterion: Record<string, AuditMetric> = {};
  for (const [id, c] of perCrit) perCriterion[id] = metric(c.flips, c.agrees, c.n);

  return { overall: metric(overallFlips, overallAgrees, n), perCriterion };
}

/**
 * Per-pair confidence for the fit, derived from whether a replica agreed on the overall
 * verdict. Pairs without a replica use the default `base` confidence.
 */
export function pairConfidence(replica: ReplicatedPair | undefined, base = 1.0): number {
  if (!replica) return base;
  return replica.pass0.overall === replica.pass1.overall ? AGREE_CONFIDENCE : DISAGREE_CONFIDENCE;
}
