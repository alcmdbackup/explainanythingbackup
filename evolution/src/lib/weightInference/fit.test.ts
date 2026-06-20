// Unit tests for the weight fit: recovers known weights from synthetic verdict data,
// enforces non-negative sum-1 output, and exercises the guards (non-identifiable pin,
// disagrees-with-overall clamp, separation, degenerate, collinearity).

import fc from 'fast-check';
import { createSeededRng } from '../metrics/experimentMetrics';
import { fitWeights, predictOverall } from './fit';
import type { PairObservation, Verdict3 } from './types';
import { signToVerdict, verdictToSign } from './verdicts';

const VERDICTS: Verdict3[] = ['a', 'b', 'tie'];

/** Generate pairs whose overall = the exact weighted vote of per-criterion verdicts. */
function synth(
  trueWeights: Record<string, number>,
  n: number,
  seed: number,
  opts: { tieRate?: number } = {},
): PairObservation[] {
  const rng = createSeededRng(seed);
  const ids = Object.keys(trueWeights);
  const tieRate = opts.tieRate ?? 0.2;
  const out: PairObservation[] = [];
  let guard = 0;
  while (out.length < n && guard < n * 50) {
    guard++;
    const dims: Record<string, Verdict3> = {};
    let score = 0;
    for (const id of ids) {
      const r = rng();
      const v: Verdict3 = r < tieRate ? 'tie' : r < tieRate + (1 - tieRate) / 2 ? 'a' : 'b';
      dims[id] = v;
      score += trueWeights[id]! * verdictToSign(v);
    }
    const overall = signToVerdict(score);
    if (overall === 'tie') continue; // need a decisive label
    out.push({ overall, dims });
  }
  return out;
}

describe('fitWeights', () => {
  it('recovers the ordering + approximate magnitude of known weights', () => {
    const truth = { clarity: 0.5, depth: 0.3, tone: 0.2 };
    const obs = synth(truth, 200, 42);
    const res = fitWeights(obs, ['clarity', 'depth', 'tone']);

    const w = new Map(res.weights.map((x) => [x.criteriaId, x.weight]));
    const clarity = w.get('clarity')!;
    const depth = w.get('depth')!;
    const tone = w.get('tone')!;
    expect(clarity).toBeGreaterThan(depth);
    expect(depth).toBeGreaterThan(tone);
    expect(res.trainAccuracy).toBeGreaterThan(0.9);
    // recovered clarity weight should be the dominant share
    expect(clarity).toBeGreaterThan(0.4);
  });

  it('always outputs non-negative weights that sum to 1 (or all-zero)', () => {
    const obs = synth({ a: 0.6, b: 0.4 }, 60, 7);
    const res = fitWeights(obs, ['a', 'b']);
    const sum = res.weights.reduce((s, x) => s + x.weight, 0);
    expect(res.weights.every((x) => x.weight >= 0)).toBe(true);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('pins an always-tie (zero-variance) criterion to 0 and flags it non-identifiable', () => {
    const base = synth({ clarity: 0.7, depth: 0.3 }, 120, 11);
    const obs = base.map((o) => ({ ...o, dims: { ...o.dims, dead: 'tie' as Verdict3 } }));
    const res = fitWeights(obs, ['clarity', 'depth', 'dead']);
    const dead = res.weights.find((x) => x.criteriaId === 'dead')!;
    expect(dead.weight).toBe(0);
    expect(res.flags.nonIdentifiable).toContain('dead');
  });

  it('clamps + flags a criterion whose verdict opposes the overall', () => {
    // "contrarian" always votes opposite to the (clarity-driven) overall.
    const ids = ['clarity', 'contrarian'];
    const rng = createSeededRng(5);
    const obs: PairObservation[] = [];
    while (obs.length < 150) {
      const cl: Verdict3 = rng() < 0.5 ? 'a' : 'b';
      const overall = cl; // clarity drives the overall
      const contrarian: Verdict3 = cl === 'a' ? 'b' : 'a';
      obs.push({ overall, dims: { clarity: cl, contrarian } });
    }
    const res = fitWeights(obs, ids);
    expect(res.flags.disagreesWithOverall).toContain('contrarian');
    expect(res.weights.find((x) => x.criteriaId === 'contrarian')!.weight).toBe(0);
    expect(res.weights.find((x) => x.criteriaId === 'clarity')!.weight).toBeCloseTo(1, 5);
  });

  it('drops overall-tie observations from the fit', () => {
    const obs = synth({ a: 0.5, b: 0.5 }, 40, 3);
    const withTies: PairObservation[] = [
      ...obs,
      { overall: 'tie', dims: { a: 'a', b: 'b' } },
      { overall: 'tie', dims: { a: 'tie', b: 'tie' } },
    ];
    const res = fitWeights(withTies, ['a', 'b']);
    expect(res.nPairs).toBe(obs.length); // ties excluded
  });

  it('handles perfect separation with finite weights (no NaN/Inf)', () => {
    const obs: PairObservation[] = [];
    for (let i = 0; i < 30; i++) {
      const v: Verdict3 = i % 2 === 0 ? 'a' : 'b';
      obs.push({ overall: v, dims: { sep: v } }); // sep perfectly predicts overall
    }
    const res = fitWeights(obs, ['sep']);
    expect(res.weights.every((x) => Number.isFinite(x.weight))).toBe(true);
    expect(res.weights[0]!.weight).toBeCloseTo(1, 5);
  });

  it('marks too-few-pairs degenerate without NaN', () => {
    const obs: PairObservation[] = [{ overall: 'a', dims: { x: 'a', y: 'b' } }];
    const res = fitWeights(obs, ['x', 'y']);
    expect(res.degenerate).toBe(true);
    expect(res.weights.every((x) => Number.isFinite(x.weight))).toBe(true);
  });

  it('returns all-zero + degenerate when there is no usable data', () => {
    const res = fitWeights([], ['x', 'y']);
    expect(res.degenerate).toBe(true);
    expect(res.weights.every((x) => x.weight === 0)).toBe(true);
  });

  it('flags collinear criteria that move together', () => {
    const rng = createSeededRng(99);
    const obs: PairObservation[] = [];
    while (obs.length < 120) {
      const v: Verdict3 = rng() < 0.5 ? 'a' : 'b';
      const overall = v;
      // twinA and twinB always carry the identical verdict
      obs.push({ overall, dims: { twinA: v, twinB: v } });
    }
    const res = fitWeights(obs, ['twinA', 'twinB']);
    expect(res.flags.collinear.length).toBeGreaterThan(0);
  });

  it('reports a cross-validated held-out accuracy when enough data', () => {
    const obs = synth({ clarity: 0.6, depth: 0.4 }, 100, 21);
    const res = fitWeights(obs, ['clarity', 'depth']);
    expect(res.heldOutAccuracy).not.toBeNull();
    expect(res.heldOutAccuracy!).toBeGreaterThan(0.8);
  });

  it('property: weights are always non-negative and sum to 1 or all-zero', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            overall: fc.constantFrom<Verdict3>('a', 'b', 'tie'),
            c1: fc.constantFrom<Verdict3>('a', 'b', 'tie'),
            c2: fc.constantFrom<Verdict3>('a', 'b', 'tie'),
            c3: fc.constantFrom<Verdict3>('a', 'b', 'tie'),
          }),
          { maxLength: 40 },
        ),
        (rows) => {
          const obs: PairObservation[] = rows.map((r) => ({
            overall: r.overall,
            dims: { c1: r.c1, c2: r.c2, c3: r.c3 },
          }));
          const res = fitWeights(obs, ['c1', 'c2', 'c3']);
          const sum = res.weights.reduce((s, x) => s + x.weight, 0);
          const allFinite = res.weights.every((x) => Number.isFinite(x.weight) && x.weight >= 0);
          return allFinite && (Math.abs(sum - 1) < 1e-6 || sum === 0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('predictOverall', () => {
  it('returns the higher-weighted side', () => {
    const weights = [
      { criteriaId: 'big', weight: 0.8 },
      { criteriaId: 'small', weight: 0.2 },
    ];
    expect(predictOverall(weights, { big: 'a', small: 'b' })).toBe('a');
    expect(predictOverall(weights, { big: 'b', small: 'a' })).toBe('b');
    expect(predictOverall(weights, { big: 'tie', small: 'tie' })).toBe('tie');
  });
});
