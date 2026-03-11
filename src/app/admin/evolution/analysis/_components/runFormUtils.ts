// Legacy: utilities for manual experiment run configuration.
// Kept for backward compat; ExperimentForm now uses strategy-based selection instead.

import { DEFAULT_EVOLUTION_CONFIG } from '@evolution/lib/config';
export { MODEL_OPTIONS } from '@/lib/utils/modelOptions';

export interface RunFormState {
  generationModel: string;
  judgeModel: string;
  enabledAgents: string[];
}

export const DEFAULT_RUN_STATE: RunFormState = {
  generationModel: DEFAULT_EVOLUTION_CONFIG.generationModel ?? 'gpt-4.1-mini',
  judgeModel: DEFAULT_EVOLUTION_CONFIG.judgeModel ?? 'gpt-4.1-nano',
  enabledAgents: [],
};

interface RunFormConfig {
  generationModel: string;
  judgeModel: string;
  enabledAgents: string[] | undefined;
}

export function runFormToConfig(form: RunFormState): RunFormConfig {
  return {
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    enabledAgents: form.enabledAgents.length > 0 ? form.enabledAgents : undefined,
  };
}
