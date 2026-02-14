// Tests for strategy form pure utility functions: formToConfig and rowToForm.
import { formToConfig, rowToForm, DEFAULT_BUDGET_CAPS, type FormState } from './strategyFormUtils';
import type { StrategyConfigRow } from '@/lib/evolution/core/strategyConfig';

const DEFAULT_ENABLED_AGENTS = ['evolution', 'reflection', 'debate', 'iterativeEditing', 'treeSearch', 'outlineGeneration', 'sectionDecomposition'];

describe('formToConfig', () => {
  const baseForm: FormState = {
    name: 'Test Strategy',
    description: 'desc',
    pipelineType: 'full',
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterations: 5,
    budgetCaps: { generation: 0.30, calibration: 0.20, tournament: 0.25 },
    enabledAgents: ['evolution', 'reflection'],
    singleArticle: false,
  };

  it('passes full budgetCaps record (not hardcoded subset)', () => {
    const config = formToConfig(baseForm);
    expect(config.budgetCaps).toEqual({ generation: 0.30, calibration: 0.20, tournament: 0.25 });
    expect(Object.keys(config.budgetCaps)).toHaveLength(3);
  });

  it('includes all form fields in config', () => {
    const config = formToConfig(baseForm);
    expect(config.generationModel).toBe('gpt-4.1-mini');
    expect(config.judgeModel).toBe('gpt-4.1-nano');
    expect(config.iterations).toBe(5);
    expect(config.enabledAgents).toEqual(['evolution', 'reflection']);
    expect(config.singleArticle).toBeUndefined();
  });

  it('passes singleArticle when true', () => {
    const config = formToConfig({ ...baseForm, singleArticle: true });
    expect(config.singleArticle).toBe(true);
  });
});

describe('rowToForm', () => {
  const baseRow: StrategyConfigRow = {
    id: 'test-id',
    config_hash: 'abc',
    name: 'Row Strategy',
    description: 'desc',
    label: 'ROW',
    config: {
      generationModel: 'deepseek-chat',
      judgeModel: 'gpt-4.1-nano',
      iterations: 3,
      budgetCaps: { generation: 0.25, calibration: 0.10 },
      enabledAgents: ['evolution'],
      singleArticle: true,
    },
    is_predefined: false,
    pipeline_type: 'minimal',
    status: 'active',
    created_by: 'admin',
    run_count: 0,
    total_cost_usd: 0,
    avg_final_elo: null,
    avg_elo_per_dollar: null,
    best_final_elo: null,
    worst_final_elo: null,
    stddev_final_elo: null,
    first_used_at: '2026-01-01',
    last_used_at: '2026-01-01',
    created_at: '2026-01-01',
  };

  it('merges row budgetCaps with defaults (fills missing agents)', () => {
    const form = rowToForm(baseRow, DEFAULT_ENABLED_AGENTS);
    // Should have all 11 default agents + overrides from row
    expect(form.budgetCaps.generation).toBe(0.25); // from row
    expect(form.budgetCaps.calibration).toBe(0.10); // from row
    expect(form.budgetCaps.tournament).toBe(DEFAULT_BUDGET_CAPS.tournament); // from default
    expect(form.budgetCaps.evolution).toBe(DEFAULT_BUDGET_CAPS.evolution); // from default
    expect(Object.keys(form.budgetCaps).length).toBe(Object.keys(DEFAULT_BUDGET_CAPS).length);
  });

  it('loads all fields from row', () => {
    const form = rowToForm(baseRow, DEFAULT_ENABLED_AGENTS);
    expect(form.name).toBe('Row Strategy');
    expect(form.pipelineType).toBe('minimal');
    expect(form.singleArticle).toBe(true);
    expect(form.enabledAgents).toEqual(['evolution']);
  });

  it('uses default enabled agents when row has undefined', () => {
    const rowNoAgents = {
      ...baseRow,
      config: { ...baseRow.config, enabledAgents: undefined },
    };
    const form = rowToForm(rowNoAgents, DEFAULT_ENABLED_AGENTS);
    expect(form.enabledAgents).toEqual(DEFAULT_ENABLED_AGENTS);
  });
});
