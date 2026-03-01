// Tests for buildExperimentReportPrompt: prompt construction and edge cases.
import { buildExperimentReportPrompt, REPORT_MODEL } from './experimentReportPrompt';

describe('buildExperimentReportPrompt', () => {
  it('builds prompt with complete data', () => {
    const prompt = buildExperimentReportPrompt({
      experiment: {
        name: 'Test Exp',
        optimization_target: 'elo',
        total_budget_usd: 10,
        spent_usd: 5,
        status: 'converged',
        current_round: 2,
        max_rounds: 5,
        factor_definitions: {
          model: { low: 'deepseek-chat', high: 'gpt-4.1-mini' },
        },
      },
      rounds: [{
        round_number: 1,
        type: 'screening',
        design: 'L8',
        status: 'completed',
        analysis_results: {
          mainEffects: { model: { effect: 15.2 } },
          factorRanking: [{ factor: 'model', importance: 0.85 }],
          recommendations: ['Use gpt-4.1-mini'],
        },
      }],
      runs: [{ id: 'run-1', status: 'completed', total_cost_usd: 0.5 }],
      agentMetrics: [{ agent_name: 'evolution', cost_usd: 0.3, elo_gain: 10 }],
      resultsSummary: { bestElo: 1350, bestConfig: { model: 'gpt-4.1-mini' }, terminationReason: 'converged' },
    });

    expect(prompt).toContain('Test Exp');
    expect(prompt).toContain('FACTOR DEFINITIONS:');
    expect(prompt).toContain('model: low=deepseek-chat, high=gpt-4.1-mini');
    expect(prompt).toContain('ROUND-BY-ROUND ANALYSIS:');
    expect(prompt).toContain('+15.20');
    expect(prompt).toContain('AGENT PERFORMANCE:');
    expect(prompt).toContain('evolution');
    expect(prompt).toContain('BEST RESULT:');
    expect(prompt).toContain('1350');
    expect(prompt).toContain('Executive Summary');
  });

  it('handles empty rounds', () => {
    const prompt = buildExperimentReportPrompt({
      experiment: { name: 'Empty', status: 'failed' },
      rounds: [],
      runs: [],
      agentMetrics: [],
      resultsSummary: null,
    });
    expect(prompt).toContain('Empty');
    expect(prompt).not.toContain('ROUND-BY-ROUND ANALYSIS:');
    expect(prompt).not.toContain('AGENT PERFORMANCE:');
  });

  it('handles null resultsSummary', () => {
    const prompt = buildExperimentReportPrompt({
      experiment: { name: 'Null Summary' },
      rounds: [],
      runs: [],
      agentMetrics: [],
      resultsSummary: null,
    });
    expect(prompt).not.toContain('BEST RESULT:');
  });

  it('exports correct REPORT_MODEL', () => {
    expect(REPORT_MODEL).toBe('gpt-4.1-nano');
  });
});
