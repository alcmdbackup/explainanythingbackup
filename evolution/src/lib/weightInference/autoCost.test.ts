// Unit tests for the auto-mode pre-flight cost cap.

import {
  assertWithinWeightInferenceAutoCap,
  autoModeEnabled,
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
