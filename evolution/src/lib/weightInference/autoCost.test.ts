// Unit tests for the auto-mode pre-flight cost cap.

import {
  assertWithinWeightInferenceAutoCap,
  autoModeEnabled,
  estimateAutoRunCost,
  getAutoChunkPairs,
  plannedCalls,
  WeightInferenceAutoCapError,
  WeightInferenceAutoDisabledError,
} from './autoCost';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe('plannedCalls', () => {
  it('is pairs × repeats × 4', () => {
    expect(plannedCalls(10, 1)).toBe(40);
    expect(plannedCalls(10, 3)).toBe(120);
    expect(plannedCalls(0, 5)).toBe(0);
  });
});

describe('assertWithinWeightInferenceAutoCap', () => {
  it('throws disabled when the kill switch is off', () => {
    withEnv({ WEIGHT_INFERENCE_AUTO_ENABLED: 'false' }, () => {
      expect(() => assertWithinWeightInferenceAutoCap({ remainingPairs: 1, repeats: 1 })).toThrow(
        WeightInferenceAutoDisabledError,
      );
    });
  });

  it('passes under the call ceiling', () => {
    withEnv({ WEIGHT_INFERENCE_AUTO_ENABLED: undefined, WEIGHT_INFERENCE_AUTO_MAX_CALLS: '8000' }, () => {
      expect(() => assertWithinWeightInferenceAutoCap({ remainingPairs: 40, repeats: 1 })).not.toThrow();
    });
  });

  it('throws cap when planned calls exceed the ceiling', () => {
    withEnv({ WEIGHT_INFERENCE_AUTO_ENABLED: undefined, WEIGHT_INFERENCE_AUTO_MAX_CALLS: '100' }, () => {
      expect(() => assertWithinWeightInferenceAutoCap({ remainingPairs: 100, repeats: 1 })).toThrow(
        WeightInferenceAutoCapError,
      );
    });
  });

  it('throws cap when estimated cost exceeds the USD ceiling', () => {
    withEnv(
      { WEIGHT_INFERENCE_AUTO_ENABLED: undefined, WEIGHT_INFERENCE_AUTO_MAX_CALLS: '100000', WEIGHT_INFERENCE_AUTO_MAX_USD: '1' },
      () => {
        expect(() =>
          assertWithinWeightInferenceAutoCap({ remainingPairs: 100, repeats: 1, estCostPerCall: 0.5 }),
        ).toThrow(WeightInferenceAutoCapError);
      },
    );
  });
});

describe('estimateAutoRunCost', () => {
  const base = { matches: 48, repeats: 1, model: 'gpt-3.5-turbo', avgArticleChars: 4000, criteriaCount: 4 };

  it('perCallUsd equals totalUsd / plannedCalls (single source of truth for the cap)', () => {
    const est = estimateAutoRunCost(base);
    expect(est.plannedCalls).toBe(plannedCalls(base.matches, base.repeats));
    expect(est.perCallUsd).toBeCloseTo(est.totalUsd / est.plannedCalls, 10);
    expect(est.totalUsd).toBeGreaterThan(0);
  });

  it('returns zero (no NaN) on a degenerate/empty pool', () => {
    for (const bad of [0, NaN, -5]) {
      const est = estimateAutoRunCost({ ...base, avgArticleChars: bad });
      expect(est.totalUsd).toBe(0);
      expect(est.perCallUsd).toBe(0);
      expect(Number.isNaN(est.totalUsd)).toBe(false);
    }
    const noMatches = estimateAutoRunCost({ ...base, matches: 0 });
    expect(noMatches.totalUsd).toBe(0);
    expect(noMatches.perCallUsd).toBe(0);
  });

  it('scales ~linearly with matches and repeats', () => {
    const one = estimateAutoRunCost(base).totalUsd;
    expect(estimateAutoRunCost({ ...base, matches: base.matches * 2 }).totalUsd).toBeCloseTo(one * 2, 6);
    expect(estimateAutoRunCost({ ...base, repeats: 3 }).totalUsd).toBeCloseTo(one * 3, 6);
  });

  it('grows with criteria count (rubric calls carry per-criterion overhead)', () => {
    const fewer = estimateAutoRunCost({ ...base, criteriaCount: 2 }).totalUsd;
    const more = estimateAutoRunCost({ ...base, criteriaCount: 10 }).totalUsd;
    expect(more).toBeGreaterThan(fewer);
  });

  it('a more expensive model costs more', () => {
    const cheap = estimateAutoRunCost({ ...base, model: 'gpt-3.5-turbo' }).totalUsd; // 0.50/1.50 per 1M
    const dear = estimateAutoRunCost({ ...base, model: 'gpt-4' }).totalUsd; // 30/60 per 1M
    expect(dear).toBeGreaterThan(cheap);
  });
});

describe('env helpers', () => {
  it('autoModeEnabled defaults on, off only for exact "false"', () => {
    withEnv({ WEIGHT_INFERENCE_AUTO_ENABLED: undefined }, () => expect(autoModeEnabled()).toBe(true));
    withEnv({ WEIGHT_INFERENCE_AUTO_ENABLED: 'false' }, () => expect(autoModeEnabled()).toBe(false));
    withEnv({ WEIGHT_INFERENCE_AUTO_ENABLED: '0' }, () => expect(autoModeEnabled()).toBe(true));
  });

  it('getAutoChunkPairs defaults to 40', () => {
    withEnv({ WEIGHT_INFERENCE_AUTO_CHUNK_PAIRS: undefined }, () => expect(getAutoChunkPairs()).toBe(40));
    withEnv({ WEIGHT_INFERENCE_AUTO_CHUNK_PAIRS: '10' }, () => expect(getAutoChunkPairs()).toBe(10));
  });
});
