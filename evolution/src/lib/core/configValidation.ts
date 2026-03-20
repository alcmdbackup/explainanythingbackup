// Config validation for evolution pipeline strategies.
// Pure module (no Node.js-only imports) — safe for both server and 'use client' components.

import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import { validateAgentSelection } from './budgetRedistribution';
import type { StrategyConfig } from './strategyConfig';
import type { AgentName } from '../types';
import { MAX_RUN_BUDGET_USD } from '../config';

// ─── Test name filtering ────────────────────────────────────────

/** Returns true if a prompt/strategy name looks like a test entry. */
export function isTestEntry(name: string): boolean {
  return name.toLowerCase().includes('test');
}

/** All allowed model names from the Zod schema. */
const ALLOWED_MODELS: Set<string> = new Set(allowedLLMModelSchema.options);

// ─── Shared validation helpers ─────────────────────────────────

/** Validate enabledAgents if present. */
export function validateAgents(
  enabledAgents: AgentName[] | undefined,
  errors: string[],
): void {
  if (!enabledAgents) return;
  errors.push(...validateAgentSelection(enabledAgents));
}

// ─── Strategy config validation ────────────────────────────────

/** Validates a StrategyConfig (from strategy_configs table, used client-side). */
export function validateStrategyConfig(
  config: StrategyConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Model names — only validate when present (partial configs get defaults from resolveConfig)
  if (config.generationModel && !ALLOWED_MODELS.has(config.generationModel)) {
    errors.push(`Invalid generation model: "${config.generationModel}". Allowed: ${[...ALLOWED_MODELS].join(', ')}`);
  }
  if (config.judgeModel && !ALLOWED_MODELS.has(config.judgeModel)) {
    errors.push(`Invalid judge model: "${config.judgeModel}". Allowed: ${[...ALLOWED_MODELS].join(', ')}`);
  }

  validateAgents(config.enabledAgents, errors);

  // Iterations — only validate when explicitly set (undefined/null = use defaults)
  if (config.iterations != null && config.iterations <= 0) {
    errors.push(`Iterations must be > 0, got ${config.iterations}`);
  }

  // Budget cap — only validate when present
  if (config.budgetCapUsd != null) {
    if (config.budgetCapUsd < 0.01) {
      errors.push(`Budget cap must be >= $0.01, got $${config.budgetCapUsd}`);
    }
    if (config.budgetCapUsd > MAX_RUN_BUDGET_USD) {
      errors.push(`Budget cap must be <= $${MAX_RUN_BUDGET_USD.toFixed(2)}, got $${config.budgetCapUsd}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
