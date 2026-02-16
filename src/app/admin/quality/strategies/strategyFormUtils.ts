// Pure utility functions for strategy form state ↔ config conversion.
// Extracted from the 'use client' page component for testability.

import type { StrategyConfig, StrategyConfigRow } from '@/lib/evolution/core/strategyConfig';
import type { AgentName } from '@/lib/evolution/core/pipeline';
import type { PipelineType } from '@/lib/evolution/types';
import { DEFAULT_EVOLUTION_CONFIG } from '@/lib/evolution/config';

export interface FormState {
  name: string;
  description: string;
  pipelineType: PipelineType;
  generationModel: string;
  judgeModel: string;
  iterations: number;
  budgetCaps: Record<string, number>;
  enabledAgents: string[];
  singleArticle: boolean;
}

/** Default: initialize budgetCaps from DEFAULT_EVOLUTION_CONFIG. */
export const DEFAULT_BUDGET_CAPS: Record<string, number> = { ...DEFAULT_EVOLUTION_CONFIG.budgetCaps };

export function formToConfig(form: FormState): StrategyConfig {
  return {
    generationModel: form.generationModel,
    judgeModel: form.judgeModel,
    iterations: form.iterations,
    budgetCaps: { ...form.budgetCaps },
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
    budgetCaps: { ...DEFAULT_BUDGET_CAPS, ...row.config.budgetCaps },
    enabledAgents: row.config.enabledAgents
      ? [...row.config.enabledAgents] as string[]
      : defaultEnabledAgents,
    singleArticle: row.config.singleArticle ?? false,
  };
}
