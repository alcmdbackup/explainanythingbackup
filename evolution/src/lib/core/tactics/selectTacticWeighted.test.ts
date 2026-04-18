// Unit tests for weighted tactic selection.

import { selectTacticWeighted, type GuidanceEntry } from './selectTacticWeighted';
import { SeededRandom } from '../../shared/seededRandom';

describe('selectTacticWeighted', () => {
  const seed = BigInt(42);

  it('returns the only tactic when guidance has one entry', () => {
    const guidance: GuidanceEntry[] = [{ tactic: 'structural_transform', percent: 100 }];
    const rng = new SeededRandom(seed);
    expect(selectTacticWeighted(guidance, rng)).toBe('structural_transform');
  });

  it('throws on empty guidance', () => {
    const rng = new SeededRandom(seed);
    expect(() => selectTacticWeighted([], rng)).toThrow('empty');
  });

  it('throws on zero total percent', () => {
    const guidance: GuidanceEntry[] = [
      { tactic: 'a', percent: 0 },
      { tactic: 'b', percent: 0 },
    ];
    const rng = new SeededRandom(seed);
    expect(() => selectTacticWeighted(guidance, rng)).toThrow('total percent <= 0');
  });

  it('is deterministic with same seed', () => {
    const guidance: GuidanceEntry[] = [
      { tactic: 'a', percent: 50 },
      { tactic: 'b', percent: 30 },
      { tactic: 'c', percent: 20 },
    ];
    const results1 = Array.from({ length: 20 }, () => selectTacticWeighted(guidance, new SeededRandom(seed)));
    const results2 = Array.from({ length: 20 }, () => selectTacticWeighted(guidance, new SeededRandom(seed)));
    expect(results1).toEqual(results2);
  });

  it('respects weights approximately over many samples', () => {
    const guidance: GuidanceEntry[] = [
      { tactic: 'heavy', percent: 80 },
      { tactic: 'light', percent: 20 },
    ];
    const counts: Record<string, number> = { heavy: 0, light: 0 };
    for (let i = 0; i < 1000; i++) {
      const rng = new SeededRandom(BigInt(i));
      const result = selectTacticWeighted(guidance, rng);
      counts[result]!++;
    }
    // 80/20 split — heavy should be 700-900 out of 1000
    expect(counts.heavy).toBeGreaterThan(700);
    expect(counts.heavy).toBeLessThan(900);
    expect(counts.light).toBeGreaterThan(100);
  });

  it('normalizes percentages that do not sum to 100', () => {
    const guidance: GuidanceEntry[] = [
      { tactic: 'a', percent: 10 },
      { tactic: 'b', percent: 10 },
    ];
    // Both have equal weight — should be ~50/50
    const counts: Record<string, number> = { a: 0, b: 0 };
    for (let i = 0; i < 500; i++) {
      const rng = new SeededRandom(BigInt(i));
      counts[selectTacticWeighted(guidance, rng)]!++;
    }
    expect(counts.a).toBeGreaterThan(180);
    expect(counts.b).toBeGreaterThan(180);
  });
});
