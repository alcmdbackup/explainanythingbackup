// Pure utility functions for strategy form state <-> config conversion.
// Extracted from the 'use client' page component for testability.

import type { StrategyConfig, StrategyConfigRow } from '@evolution/lib/core/strategyConfig';
import type { AgentName } from '@evolution/lib/types';

export interface FormState {
  name: string;
  description: string;
  generationModel: string;
  judgeModel: string;
  iterations: number;
  enabledAgents: string[];
  singleArticle: boolean;
  budgetCapUsd: number;
}

export function formToConfig(form: FormState): StrategyConfig {
  return {
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    iterations: form.iterations,
    enabledAgents: form.enabledAgents as AgentName[],
    singleArticle: form.singleArticle || undefined,
    budgetCapUsd: form.budgetCapUsd > 0 ? form.budgetCapUsd : undefined,
  };
}

export function rowToForm(row: StrategyConfigRow, defaultEnabledAgents: string[]): FormState {
  return {
    name: row.name,
    description: row.description ?? '',
    generationModel: row.config.generationModel,
    judgeModel: row.config.judgeModel,
    iterations: row.config.iterations,
    enabledAgents: defaultEnabledAgents,
    singleArticle: false,
    budgetCapUsd: row.config.budgetUsd ?? 0.50,
  };
}
