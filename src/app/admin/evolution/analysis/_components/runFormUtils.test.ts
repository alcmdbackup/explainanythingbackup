// Tests for runFormUtils: form state defaults and config conversion.
import { DEFAULT_RUN_STATE, runFormToConfig, MODEL_OPTIONS } from './runFormUtils';

describe('runFormUtils', () => {
  it('MODEL_OPTIONS contains expected models', () => {
    expect(MODEL_OPTIONS).toContain('gpt-4.1-mini');
    expect(MODEL_OPTIONS).toContain('claude-sonnet-4-20250514');
    expect(MODEL_OPTIONS.length).toBeGreaterThan(3);
  });

  it('DEFAULT_RUN_STATE has valid defaults', () => {
    expect(DEFAULT_RUN_STATE.generationModel).toBeTruthy();
    expect(DEFAULT_RUN_STATE.judgeModel).toBeTruthy();
    expect(DEFAULT_RUN_STATE.enabledAgents).toEqual([]);
  });

  it('runFormToConfig converts form state to API shape', () => {
    const config = runFormToConfig({
      generationModel: 'gpt-4o',
      judgeModel: 'gpt-4.1-nano',
      enabledAgents: ['reflection', 'debate'],
    });

    expect(config).toEqual({
      generationModel: 'gpt-4o',
      judgeModel: 'gpt-4.1-nano',
      enabledAgents: ['reflection', 'debate'],
    });
  });

  it('runFormToConfig omits enabledAgents when empty', () => {
    const config = runFormToConfig({
      generationModel: 'gpt-4o',
      judgeModel: 'gpt-4.1-nano',
      enabledAgents: [],
    });

    expect(config.enabledAgents).toBeUndefined();
  });
});
