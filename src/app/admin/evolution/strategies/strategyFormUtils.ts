// Pure utility functions for strategy form state <-> config conversion.
// Extracted from the 'use client' page component for testability.

import type { StrategyConfig, StrategyConfigRow } from '@evolution/lib/core/strategyConfig';

export interface FormState {
  name: string;
  description: string;
  generationModel: string;
  judgeModel: string;
  iterations: number;
  budgetCapUsd: number;
}

export function formToConfig(form: FormState): StrategyConfig {
  return {
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    iterations: form.iterations,
    budgetCapUsd: form.budgetCapUsd > 0 ? form.budgetCapUsd : undefined,
  };
}

export function rowToForm(row: StrategyConfigRow): FormState {
  return {
    name: row.name,
    description: row.description ?? '',
    generationModel: row.config.generationModel,
    judgeModel: row.config.judgeModel,
    iterations: row.config.iterations,
    budgetCapUsd: row.config.budgetUsd ?? 0.50,
  };
}
