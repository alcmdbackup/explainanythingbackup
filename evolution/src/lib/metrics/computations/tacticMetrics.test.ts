// Unit tests for tactic metrics computation — avg_elo with bootstrap CI, avg_elo_delta, win_rate.

import { bootstrapMeanCI, type MetricValue } from '../experimentMetrics';

/** Helper to create a MetricValue input for bootstrapMeanCI. */
function mv(value: number, uncertainty: number | null): MetricValue {
  return { value, uncertainty, ci: null, n: 1 };
}

describe('tactic metrics — bootstrapMeanCI for tactic use cases', () => {
  const seededRng = () => {
    let s = 42;
    return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0x100000000; };
  };

  it('avg_elo: single variant returns value with no CI', () => {
    const result = bootstrapMeanCI([mv(1300, 72)]);
    expect(result.value).toBe(1300);
    expect(result.uncertainty).toBe(72);
    expect(result.ci).toEqual([1300 - 1.96 * 72, 1300 + 1.96 * 72]);
    expect(result.n).toBe(1);
  });

  it('avg_elo: multiple variants produces bootstrap CI', () => {
    const values = [mv(1250, 60), mv(1350, 45), mv(1280, 70), mv(1320, 50)];
    const result = bootstrapMeanCI(values, 1000, seededRng());
    expect(result.value).toBeCloseTo(1300, 0);
    expect(result.ci).not.toBeNull();
    expect(result.ci![0]).toBeLessThan(result.value);
    expect(result.ci![1]).toBeGreaterThan(result.value);
    expect(result.n).toBe(4);
  });

  it('avg_elo_delta: computes delta from 1200 baseline', () => {
    const elos = [1250, 1350, 1280];
    const deltaValues = elos.map(e => mv(e - 1200, 60));
    const result = bootstrapMeanCI(deltaValues, 1000, seededRng());
    // Mean delta should be ~(50+150+80)/3 = ~93.3
    expect(result.value).toBeCloseTo(93.3, 0);
    expect(result.ci).not.toBeNull();
    expect(result.n).toBe(3);
  });

  it('win_rate: computes fraction with CI', () => {
    const winValues = [mv(1, null), mv(0, null), mv(0, null), mv(1, null), mv(0, null)];
    const result = bootstrapMeanCI(winValues, 1000, seededRng());
    expect(result.value).toBeCloseTo(0.4, 1);
    expect(result.ci).not.toBeNull();
    expect(result.ci![0]).toBeGreaterThanOrEqual(0);
    expect(result.ci![1]).toBeLessThanOrEqual(1);
    expect(result.n).toBe(5);
  });

  it('win_rate: all losers produces 0 with tight CI', () => {
    const winValues = Array.from({ length: 10 }, () => mv(0, null));
    const result = bootstrapMeanCI(winValues, 1000, seededRng());
    expect(result.value).toBe(0);
    expect(result.ci![0]).toBe(0);
    expect(result.ci![1]).toBe(0);
  });
});
