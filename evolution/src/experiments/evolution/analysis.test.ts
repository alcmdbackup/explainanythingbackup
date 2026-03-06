// Tests for manual experiment analysis computation.

import { computeManualAnalysis } from './analysis';

describe('computeManualAnalysis', () => {
  const extractElo = (summary: Record<string, unknown> | null) =>
    (summary?.topElo as number) ?? null;

  it('computes Elo and Elo/$ for completed runs', () => {
    const dbRuns = [
      { id: 'r1', status: 'completed', total_cost_usd: 0.50, run_summary: { topElo: 1600 }, config: { generationModel: 'gpt-4.1-mini', judgeModel: 'gpt-4.1-nano' } },
      { id: 'r2', status: 'completed', total_cost_usd: 1.00, run_summary: { topElo: 1700 }, config: { generationModel: 'deepseek-chat' } },
    ];
    const result = computeManualAnalysis(dbRuns, extractElo);
    expect(result.type).toBe('manual');
    expect(result.completedRuns).toBe(2);
    expect(result.totalRuns).toBe(2);
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].elo).toBe(1600);
    expect(result.runs[0].eloPer$).toBeCloseTo((1600 - 1200) / 0.50, 1);
    expect(result.runs[1].configLabel).toBe('deepseek-chat');
    expect(result.warnings).toEqual([]);
  });

  it('warns about incomplete runs', () => {
    const dbRuns = [
      { id: 'r1', status: 'completed', total_cost_usd: 0.50, run_summary: { topElo: 1600 }, config: null },
      { id: 'r2', status: 'running', total_cost_usd: null, run_summary: null, config: null },
    ];
    const result = computeManualAnalysis(dbRuns, extractElo);
    expect(result.completedRuns).toBe(1);
    expect(result.warnings).toEqual(['1 of 2 runs incomplete']);
  });

  it('handles null summary gracefully', () => {
    const dbRuns = [
      { id: 'r1', status: 'completed', total_cost_usd: 0.30, run_summary: null, config: null },
    ];
    const result = computeManualAnalysis(dbRuns, extractElo);
    expect(result.runs[0].elo).toBeNull();
    expect(result.runs[0].eloPer$).toBeNull();
  });
});
