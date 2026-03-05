// Pure utility functions for strategy form state ↔ config conversion.
// Extracted from the 'use client' page component for testability.

import type { StrategyConfig, StrategyConfigRow } from '@evolution/lib/core/strategyConfig';
import type { AgentName } from '@evolution/lib/types';
import type { PipelineType } from '@evolution/lib/types';

export interface FormState {
  name: string;
  description: string;
  pipelineType: PipelineType;
  generationModel: string;
  judgeModel: string;
  iterations: number;
  enabledAgents: string[];
  singleArticle: boolean;
}

export function formToConfig(form: FormState): StrategyConfig {
  return {
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    iterations: form.iterations,
    enabledAgents: form.enabledAgents as AgentName[],
    singleArticle: form.singleArticle || undefined,
  };
}

export function rowToForm(row: StrategyConfigRow, defaultEnabledAgents: string[]): FormState {
  return {
    name: row.name,
    description: row.description ?? '',
    pipelineType: row.pipeline_type ?? 'full',
    generationModel: row.config.generationModel,
    judgeModel: row.config.judgeModel,
    iterations: row.config.iterations,
    enabledAgents: row.config.enabledAgents
      ? [...row.config.enabledAgents] as string[]
      : defaultEnabledAgents,
    singleArticle: row.config.singleArticle ?? false,
  };
}
