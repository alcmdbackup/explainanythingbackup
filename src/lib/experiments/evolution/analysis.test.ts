// Tests for main effects computation, interaction effects, ranking, and recommendation generation.

import {
  computeMainEffects,
  computeInteractionEffects,
  rankFactors,
  generateRecommendations,
  analyzeExperiment,
  type ExperimentRun,
} from './analysis';
import { generateL8Design } from './factorial';

// Mock runs with known Elo/cost values chosen to produce predictable main effects.
// Factor A (genModel): rows 1-4 low, rows 5-8 high
// With these values, high A runs (5-8) avg higher Elo than low A runs (1-4).
const mockRuns: ExperimentRun[] = [
  { row: 1, runId: 'mock-1', status: 'completed', topElo: 1650, costUsd: 0.82 },
  { row: 2, runId: 'mock-2', status: 'completed', topElo: 1720, costUsd: 1.45 },
  { row: 3, runId: 'mock-3', status: 'completed', topElo: 1690, costUsd: 1.30 },
  { row: 4, runId: 'mock-4', status: 'completed', topElo: 1780, costUsd: 0.95 },
  { row: 5, runId: 'mock-5', status: 'completed', topElo: 1810, costUsd: 2.50 },
  { row: 6, runId: 'mock-6', status: 'completed', topElo: 1850, costUsd: 3.20 },
  { row: 7, runId: 'mock-7', status: 'completed', topElo: 1770, costUsd: 2.80 },
  { row: 8, runId: 'mock-8', status: 'completed', topElo: 1900, costUsd: 3.50 },
];

describe('computeMainEffects', () => {
  const design = generateL8Design();

  it('computes Elo main effects for all 5 factors', () => {
    const effects = computeMainEffects(design, mockRuns);
    expect(Object.keys(effects.elo)).toHaveLength(5);
    expect(Object.keys(effects.eloPerDollar)).toHaveLength(5);
  });

  it('Factor A (genModel) has positive Elo effect (high > low)', () => {
    const effects = computeMainEffects(design, mockRuns);
    // Low A (rows 1-4): avg = (1650+1720+1690+1780)/4 = 1710
    // High A (rows 5-8): avg = (1810+1850+1770+1900)/4 = 1832.5
    // Effect = 1832.5 - 1710 = 122.5
    expect(effects.elo.A).toBeCloseTo(122.5, 1);
  });

  it('computes Elo/$ effects', () => {
    const effects = computeMainEffects(design, mockRuns);
    // Elo/$ = (topElo - 1200) / costUsd for each run
    expect(effects.eloPerDollar.A).toBeDefined();
    expect(typeof effects.eloPerDollar.A).toBe('number');
  });

  it('returns empty effects for no completed runs', () => {
    const failedRuns: ExperimentRun[] = [
      { row: 1, runId: 'f-1', status: 'failed', error: 'timeout' },
    ];
    const effects = computeMainEffects(design, failedRuns);
    expect(effects.elo).toEqual({});
  });

  it('handles partial data (fewer than 8 completed)', () => {
    const partial = mockRuns.slice(0, 4); // Only rows 1-4
    const effects = computeMainEffects(design, partial);
    // Factor A: all 4 runs are low (-1), so no high runs → effect = 0
    expect(effects.elo.A).toBe(0);
  });
});

describe('computeInteractionEffects', () => {
  const design = generateL8Design();

  it('returns interaction effects for A×C and A×E', () => {
    const interactions = computeInteractionEffects(design, mockRuns);
    expect(interactions).toHaveLength(2);
    expect(interactions[0].label).toBe('A×C');
    expect(interactions[1].label).toBe('A×E');
  });

  it('interaction effects are numeric', () => {
    const interactions = computeInteractionEffects(design, mockRuns);
    for (const i of interactions) {
      expect(typeof i.elo).toBe('number');
      expect(typeof i.eloPerDollar).toBe('number');
    }
  });

  it('returns empty for no completed runs', () => {
    const interactions = computeInteractionEffects(design, []);
    expect(interactions).toEqual([]);
  });
});

describe('rankFactors', () => {
  const design = generateL8Design();

  it('ranks factors by absolute Elo effect magnitude', () => {
    const effects = computeMainEffects(design, mockRuns);
    const ranking = rankFactors(design, effects);
    expect(ranking).toHaveLength(5);
    // First factor should have highest |effect|
    for (let i = 1; i < ranking.length; i++) {
      expect(ranking[i - 1].importance).toBeGreaterThanOrEqual(ranking[i].importance);
    }
  });

  it('includes factor labels', () => {
    const effects = computeMainEffects(design, mockRuns);
    const ranking = rankFactors(design, effects);
    const labels = ranking.map((r) => r.factorLabel);
    expect(labels).toContain('Generation Model');
    expect(labels).toContain('Iterations');
  });
});

describe('generateRecommendations', () => {
  const design = generateL8Design();

  it('generates at least one recommendation', () => {
    const effects = computeMainEffects(design, mockRuns);
    const interactions = computeInteractionEffects(design, mockRuns);
    const ranking = rankFactors(design, effects);
    const recs = generateRecommendations(design, effects, interactions, ranking);
    expect(recs.length).toBeGreaterThanOrEqual(1);
  });

  it('mentions the top factor', () => {
    const effects = computeMainEffects(design, mockRuns);
    const interactions = computeInteractionEffects(design, mockRuns);
    const ranking = rankFactors(design, effects);
    const recs = generateRecommendations(design, effects, interactions, ranking);
    expect(recs[0]).toContain('largest effect');
  });

  it('returns fallback for empty ranking', () => {
    const recs = generateRecommendations(design, { elo: {}, eloPerDollar: {} }, [], []);
    expect(recs).toEqual(['Insufficient data for recommendations.']);
  });
});

describe('analyzeExperiment', () => {
  const design = generateL8Design();

  it('produces a complete analysis result', () => {
    const result = analyzeExperiment(design, mockRuns);
    expect(result.completedRuns).toBe(8);
    expect(result.totalRuns).toBe(8);
    expect(result.warnings).toHaveLength(0);
    expect(result.factorRanking).toHaveLength(5);
    expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
  });

  it('warns about incomplete runs', () => {
    const partialRuns = [
      ...mockRuns.slice(0, 5),
      { row: 6, runId: 'f-6', status: 'failed' as const, error: 'timeout' },
      { row: 7, runId: 'f-7', status: 'pending' as const },
      { row: 8, runId: 'f-8', status: 'running' as const },
    ];
    const result = analyzeExperiment(design, partialRuns);
    expect(result.completedRuns).toBe(5);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain('incomplete');
  });

  it('warns about fewer than 4 completed runs', () => {
    const fewRuns = mockRuns.slice(0, 3);
    const result = analyzeExperiment(design, fewRuns);
    expect(result.warnings).toContainEqual(expect.stringContaining('unreliable'));
  });
});
