// Tests for strategy form pure utility functions: formToConfig and rowToForm.
import { formToConfig, rowToForm, type FormState } from './strategyFormUtils';
import type { StrategyConfigRow } from '@evolution/lib/core/strategyConfig';

const DEFAULT_ENABLED_AGENTS = ['evolution', 'reflection', 'debate', 'iterativeEditing', 'treeSearch', 'outlineGeneration', 'sectionDecomposition'];

describe('formToConfig', () => {
  const baseForm: FormState = {
    name: 'Test Strategy',
    description: 'desc',
    generationModel: 'gpt-4.1-mini',
    judgeModel: 'gpt-4.1-nano',
    iterations: 5,
    enabledAgents: ['evolution', 'reflection'],
    singleArticle: false,
    budgetCapUsd: 0.50,
  };

  it('includes all form fields in config', () => {
    const config = formToConfig(baseForm);
    expect(config.generationModel).toBe('gpt-4.1-mini');
    expect(config.judgeModel).toBe('gpt-4.1-nano');
    expect(config.iterations).toBe(5);
    expect(config.enabledAgents).toEqual(['evolution', 'reflection']);
    expect(config.singleArticle).toBeUndefined();
    expect(config.budgetCapUsd).toBe(0.50);
  });

  it('passes singleArticle when true', () => {
    const config = formToConfig({ ...baseForm, singleArticle: true });
    expect(config.singleArticle).toBe(true);
  });

  it('budgetCapUsd round-trips through form', () => {
    const config = formToConfig({ ...baseForm, budgetCapUsd: 0.25 });
    expect(config.budgetCapUsd).toBe(0.25);
  });

  it('omits budgetCapUsd when zero', () => {
    const config = formToConfig({ ...baseForm, budgetCapUsd: 0 });
    expect(config.budgetCapUsd).toBeUndefined();
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
      enabledAgents: ['evolution'],
      singleArticle: true,
      budgetCapUsd: 0.25,
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

  it('loads all fields from row', () => {
    const form = rowToForm(baseRow, DEFAULT_ENABLED_AGENTS);
    expect(form.name).toBe('Row Strategy');
    expect(form.singleArticle).toBe(true);
    expect(form.enabledAgents).toEqual(['evolution']);
    expect(form.budgetCapUsd).toBe(0.25);
  });

  it('uses default enabled agents when row has undefined', () => {
    const rowNoAgents = {
      ...baseRow,
      config: { ...baseRow.config, enabledAgents: undefined },
    };
    const form = rowToForm(rowNoAgents, DEFAULT_ENABLED_AGENTS);
    expect(form.enabledAgents).toEqual(DEFAULT_ENABLED_AGENTS);
  });

  it('defaults budgetCapUsd to 0.50 when not set in config', () => {
    const rowNoBudget = {
      ...baseRow,
      config: { ...baseRow.config, budgetCapUsd: undefined },
    };
    const form = rowToForm(rowNoBudget, DEFAULT_ENABLED_AGENTS);
    expect(form.budgetCapUsd).toBe(0.50);
  });
});
