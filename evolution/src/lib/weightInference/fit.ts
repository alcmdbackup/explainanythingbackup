// Core weight fit: back out non-negative, sum-to-1 rubric weights from per-criterion
// pairwise verdicts (features) + overall verdicts (labels). This is the production
// rubricJudge.scorePass vote with learned weights — sign(Σ wₖ·vₖ) predicts the overall.
//
// Method (committed in /plan-review): ridge-regularized logistic regression (IRLS) on
// the signed verdict vectors, then CLAMP negative coefficients to 0 and REFIT on the
// survivors (softmax was rejected — it can't yield exact-0 weights), renormalize to
// sum-1. Mandatory guards: non-zero ridge λ (handles perfect separation), iteration
// cap, sigmoid/logit clamp (no log(0)/overflow), and zero-variance columns pinned to 0.

import {
  type CriterionWeight,
  type PairObservation,
  type Verdict3,
  type WeightFitResult,
} from './types';
import { signToVerdict, verdictToSign } from './verdicts';

const EPS = 1e-6;
const DEFAULT_LAMBDA = 1.0; // ridge penalty (mandatory, non-zero)
const MAX_IRLS_ITER = 50;
const MAX_CLAMP_ROUNDS = 8;
const BARELY_MATTERS_THRESHOLD = 0.02; // normalized weight below this = "barely matters"
const COLLINEAR_AGREEMENT = 0.98; // verdict columns agreeing this often = collinear
const CV_FOLDS = 5;
const CV_MIN_PAIRS = 10;

export interface FitOptions {
  lambda?: number;
  maxIter?: number;
  /** Skip cross-validation (used internally by CV folds to avoid recursion). */
  skipCrossVal?: boolean;
}

interface UsableRow {
  x: number[]; // signed feature per criterion (+1/0/-1)
  y: number; // 1 = overall A, 0 = overall B
  w: number; // observation weight (confidence), >= 0
}

function sigmoid(eta: number): number {
  const p = 1 / (1 + Math.exp(-eta));
  if (p < EPS) return EPS;
  if (p > 1 - EPS) return 1 - EPS;
  return p;
}

/** Solve H·x = g for x (K×K, symmetric PD via ridge) with partial-pivot Gaussian elim. */
function solveLinear(H: number[][], g: number[]): number[] | null {
  const k = g.length;
  // augmented matrix
  const a: number[][] = H.map((row, i) => [...row, g[i]!]);
  for (let col = 0; col < k; col++) {
    // partial pivot
    let pivot = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    const pivRow = a[pivot]!;
    const piv = pivRow[col]!;
    if (Math.abs(piv) < 1e-12) return null; // singular
    a[pivot] = a[col]!;
    a[col] = pivRow;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const rowR = a[r]!;
      const factor = rowR[col]! / piv;
      if (factor === 0) continue;
      for (let c = col; c <= k; c++) rowR[c] = rowR[c]! - factor * pivRow[c]!;
    }
  }
  const x = new Array<number>(k);
  for (let i = 0; i < k; i++) {
    const rowI = a[i]!;
    x[i] = rowI[k]! / rowI[i]!;
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

/** Ridge logistic regression via IRLS over the given (active) feature columns. */
function fitLogisticRidge(
  rows: UsableRow[],
  activeCols: number[],
  lambda: number,
  maxIter: number,
): { beta: number[]; logLik: number } {
  const k = activeCols.length;
  const beta = new Array<number>(k).fill(0);
  if (k === 0) return { beta, logLik: 0 };

  for (let iter = 0; iter < maxIter; iter++) {
    // gradient g = Xᵀ (w ⊙ (p - y)) + λβ ; Hessian H = Xᵀ (w ⊙ p(1-p)) X + λI
    const g = new Array<number>(k).fill(0);
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (const row of rows) {
      let eta = 0;
      for (let j = 0; j < k; j++) eta += beta[j]! * row.x[activeCols[j]!]!;
      const p = sigmoid(eta);
      const wResid = row.w * (p - row.y);
      const wVar = row.w * p * (1 - p);
      for (let j = 0; j < k; j++) {
        const xj = row.x[activeCols[j]!]!;
        g[j] = g[j]! + wResid * xj;
        const Hj = H[j]!;
        for (let m = j; m < k; m++) {
          Hj[m] = Hj[m]! + wVar * xj * row.x[activeCols[m]!]!;
        }
      }
    }
    for (let j = 0; j < k; j++) {
      g[j] = g[j]! + lambda * beta[j]!;
      const Hj = H[j]!;
      Hj[j] = Hj[j]! + lambda;
      for (let m = j + 1; m < k; m++) H[m]![j] = Hj[m]!; // symmetric
    }
    const step = solveLinear(H, g);
    if (!step) break;
    let maxDelta = 0;
    for (let j = 0; j < k; j++) {
      beta[j] = beta[j]! - step[j]!;
      maxDelta = Math.max(maxDelta, Math.abs(step[j]!));
    }
    if (maxDelta < 1e-8) break;
  }

  // regularized log-likelihood
  let logLik = 0;
  for (const row of rows) {
    let eta = 0;
    for (let j = 0; j < k; j++) eta += beta[j]! * row.x[activeCols[j]!]!;
    const p = sigmoid(eta);
    logLik += row.w * (row.y * Math.log(p) + (1 - row.y) * Math.log(1 - p));
  }
  let penalty = 0;
  for (const b of beta) penalty += b * b;
  logLik -= 0.5 * lambda * penalty;

  return { beta: beta.map((b) => (Number.isFinite(b) ? b : 0)), logLik };
}

/** Predict the overall verdict from normalized weights + per-criterion verdicts. */
export function predictOverall(
  weights: CriterionWeight[],
  dims: Record<string, Verdict3>,
): Verdict3 {
  let score = 0;
  for (const { criteriaId, weight } of weights) {
    const v = dims[criteriaId];
    if (v) score += weight * verdictToSign(v);
  }
  return signToVerdict(score);
}

function accuracy(weights: CriterionWeight[], rows: PairObservation[]): number {
  if (rows.length === 0) return 0;
  let correct = 0;
  for (const obs of rows) {
    if (predictOverall(weights, obs.dims) === obs.overall) correct++;
  }
  return correct / rows.length;
}

function normalizeToWeights(
  beta: number[],
  activeCols: number[],
  criteriaIds: string[],
): CriterionWeight[] {
  const raw = new Array<number>(criteriaIds.length).fill(0);
  for (let j = 0; j < activeCols.length; j++) {
    raw[activeCols[j]!] = Math.max(0, beta[j]!);
  }
  const total = raw.reduce((s, v) => s + v, 0);
  return criteriaIds.map((criteriaId, i) => ({
    criteriaId,
    weight: total > 0 ? raw[i]! / total : 0,
  }));
}

/**
 * Fit non-negative, sum-1 rubric weights from labelled pair observations.
 * Pure + deterministic (no RNG; CV folds are index-based).
 */
export function fitWeights(
  observations: PairObservation[],
  criteriaIds: string[],
  opts: FitOptions = {},
): WeightFitResult {
  const lambda = opts.lambda ?? DEFAULT_LAMBDA;
  const maxIter = opts.maxIter ?? MAX_IRLS_ITER;
  const K = criteriaIds.length;

  // 1. usable rows: overall non-tie + every criterion present
  const usable: UsableRow[] = [];
  const usableObs: PairObservation[] = [];
  for (const obs of observations) {
    if (obs.overall === 'tie') continue;
    if (!criteriaIds.every((id) => obs.dims[id] !== undefined)) continue;
    const x = criteriaIds.map((id) => verdictToSign(obs.dims[id]!));
    const w = Math.max(0, obs.confidence ?? 1);
    if (w === 0) continue;
    usable.push({ x, y: obs.overall === 'a' ? 1 : 0, w });
    usableObs.push(obs);
  }

  const nPairs = usable.length;
  const emptyFlags = {
    barelyMatters: [] as string[],
    disagreesWithOverall: [] as string[],
    nonIdentifiable: [] as string[],
    collinear: [] as Array<[string, string]>,
  };

  if (K === 0 || nPairs === 0) {
    return {
      weights: criteriaIds.map((criteriaId) => ({ criteriaId, weight: 0 })),
      trainAccuracy: 0,
      heldOutAccuracy: null,
      logLik: 0,
      nPairs,
      flags: emptyFlags,
      degenerate: true,
    };
  }

  const firstRow = usable[0]!;

  // 2. non-identifiable columns: every value identical across usable rows (zero variance)
  const nonIdentifiable: string[] = [];
  const identifiableCols: number[] = [];
  for (let c = 0; c < K; c++) {
    const first = firstRow.x[c]!;
    const constant = usable.every((r) => r.x[c]! === first);
    if (constant) nonIdentifiable.push(criteriaIds[c]!);
    else identifiableCols.push(c);
  }

  // 3. collinearity: identifiable column pairs that agree (almost) always
  const collinear: Array<[string, string]> = [];
  for (let a = 0; a < identifiableCols.length; a++) {
    for (let b = a + 1; b < identifiableCols.length; b++) {
      const ca = identifiableCols[a]!;
      const cb = identifiableCols[b]!;
      let agree = 0;
      for (const r of usable) if (r.x[ca]! === r.x[cb]!) agree++;
      if (agree / nPairs >= COLLINEAR_AGREEMENT) {
        collinear.push([criteriaIds[ca]!, criteriaIds[cb]!]);
      }
    }
  }

  // 4. fit + clamp-and-refit on identifiable columns
  let active = [...identifiableCols];
  const disagrees = new Set<string>();
  let finalBeta: number[] = [];
  let finalLogLik = 0;
  for (let round = 0; round < MAX_CLAMP_ROUNDS; round++) {
    const { beta, logLik } = fitLogisticRidge(usable, active, lambda, maxIter);
    finalBeta = beta;
    finalLogLik = logLik;
    const survivors: number[] = [];
    const dropped: number[] = [];
    for (let j = 0; j < active.length; j++) {
      if (beta[j]! < 0) dropped.push(active[j]!);
      else survivors.push(active[j]!);
    }
    if (dropped.length === 0) break; // converged: all survivors non-negative

    for (const col of dropped) disagrees.add(criteriaIds[col]!);
    if (survivors.length === 0) {
      // every coefficient negative -> no usable weights remain
      finalBeta = [];
      active = [];
      break;
    }
    active = survivors;
  }

  const weights = normalizeToWeights(finalBeta, active, criteriaIds);
  const totalWeight = weights.reduce((s, w) => s + w.weight, 0);

  const barelyMatters = weights
    .filter((w) => w.weight > 0 && w.weight < BARELY_MATTERS_THRESHOLD)
    .map((w) => w.criteriaId);

  const trainAccuracy = accuracy(weights, usableObs);

  // 5. k-fold cross-validated accuracy (when enough data + not in a CV sub-fit)
  let heldOutAccuracy: number | null = null;
  if (!opts.skipCrossVal && nPairs >= CV_MIN_PAIRS) {
    let foldCorrect = 0;
    let foldTotal = 0;
    for (let f = 0; f < CV_FOLDS; f++) {
      const train: PairObservation[] = [];
      const test: PairObservation[] = [];
      for (let i = 0; i < usableObs.length; i++) {
        if (i % CV_FOLDS === f) test.push(usableObs[i]!);
        else train.push(usableObs[i]!);
      }
      if (train.length === 0 || test.length === 0) continue;
      const sub = fitWeights(train, criteriaIds, { ...opts, skipCrossVal: true });
      for (const obs of test) {
        if (predictOverall(sub.weights, obs.dims) === obs.overall) foldCorrect++;
        foldTotal++;
      }
    }
    heldOutAccuracy = foldTotal > 0 ? foldCorrect / foldTotal : null;
  }

  const degenerate = nPairs < Math.max(3, K + 1) || totalWeight === 0;

  return {
    weights,
    trainAccuracy,
    heldOutAccuracy,
    logLik: finalLogLik,
    nPairs,
    flags: {
      barelyMatters,
      disagreesWithOverall: [...disagrees],
      nonIdentifiable,
      collinear,
    },
    degenerate,
  };
}
