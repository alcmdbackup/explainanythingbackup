// Tests for buildExperimentReportPrompt: prompt construction and edge cases.
import { buildExperimentReportPrompt, REPORT_MODEL } from './experimentReportPrompt';

describe('buildExperimentReportPrompt', () => {
  it('builds prompt with complete data', () => {
    const prompt = buildExperimentReportPrompt({
      experiment: {
        name: 'Test Exp',
        total_budget_usd: 10,
        spent_usd: 5,
        status: 'completed',
        factor_definitions: {
          model: { low: 'deepseek-chat', high: 'gpt-4.1-mini' },
        },
        analysis_results: {
          mainEffects: { model: { effect: 15.2 } },
          factorRanking: [{ factor: 'model', importance: 0.85 }],
          recommendations: ['Use gpt-4.1-mini'],
        },
      },
      runs: [{ id: 'run-1', status: 'completed', total_cost_usd: 0.5 }],
      agentMetrics: [{ agent_name: 'evolution', cost_usd: 0.3, elo_gain: 10 }],
      resultsSummary: { bestElo: 1350, bestConfig: { model: 'gpt-4.1-mini' }, terminationReason: 'completed' },
    });

    expect(prompt).toContain('Test Exp');
    expect(prompt).toContain('FACTOR DEFINITIONS:');
    expect(prompt).toContain('model: low=deepseek-chat, high=gpt-4.1-mini');
    expect(prompt).toContain('ANALYSIS RESULTS:');
    expect(prompt).toContain('+15.20');
    expect(prompt).toContain('AGENT PERFORMANCE:');
    expect(prompt).toContain('evolution');
    expect(prompt).toContain('BEST RESULT:');
    expect(prompt).toContain('1350');
    expect(prompt).toContain('Executive Summary');
  });

  it('handles no analysis results', () => {
    const prompt = buildExperimentReportPrompt({
      experiment: { name: 'Empty', status: 'failed' },
      runs: [],
      agentMetrics: [],
      resultsSummary: null,
    });
    expect(prompt).toContain('Empty');
    expect(prompt).not.toContain('ANALYSIS RESULTS:');
    expect(prompt).not.toContain('AGENT PERFORMANCE:');
  });

  it('handles null resultsSummary', () => {
    const prompt = buildExperimentReportPrompt({
      experiment: { name: 'Null Summary' },
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
