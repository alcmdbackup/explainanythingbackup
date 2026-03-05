// Utilities for manual experiment run configuration.
// Provides form state type, defaults, and conversion to API shape.

import { DEFAULT_EVOLUTION_CONFIG } from '@evolution/lib/config';

export const MODEL_OPTIONS = [
  'deepseek-chat',
  'gpt-4.1-nano',
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-4o',
  'o3-mini',
  'claude-sonnet-4-20250514',
];

export interface RunFormState {
  generationModel: string;
  judgeModel: string;
  enabledAgents: string[];
  budgetCapUsd: number;
}

export const DEFAULT_RUN_STATE: RunFormState = {
  generationModel: DEFAULT_EVOLUTION_CONFIG.generationModel ?? 'gpt-4.1-mini',
  judgeModel: DEFAULT_EVOLUTION_CONFIG.judgeModel ?? 'gpt-4.1-nano',
  enabledAgents: [],
  budgetCapUsd: 0.50,
};

export function runFormToConfig(form: RunFormState) {
  return {
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    enabledAgents: form.enabledAgents.length > 0 ? form.enabledAgents : undefined,
    budgetCapUsd: form.budgetCapUsd,
  };
}
