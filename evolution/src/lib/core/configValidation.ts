// Config validation for evolution pipeline strategies and run configs.
// Pure module (no Node.js-only imports) — safe for both server and 'use client' components.

import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import { validateAgentSelection } from './budgetRedistribution';
import type { StrategyConfig } from './strategyConfig';
import type { EvolutionRunConfig } from '../types';
import type { AgentName } from '../types';

// ─── Test name filtering ────────────────────────────────────────

/** Returns true if a prompt/strategy name looks like a test entry. */
export function isTestEntry(name: string): boolean {
  return name.toLowerCase().includes('test');
}

/** All allowed model names from the Zod schema. */
const ALLOWED_MODELS: Set<string> = new Set(allowedLLMModelSchema.options);

// ─── Shared validation helpers ─────────────────────────────────

/** Validate enabledAgents if present. */
function validateAgents(
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

  return { valid: errors.length === 0, errors };
}

// ─── Run config validation ─────────────────────────────────────

/** Validates a complete EvolutionRunConfig (after resolveConfig merges defaults). */
export function validateRunConfig(
  config: EvolutionRunConfig
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Model names — strict check for resolved config (must be present and valid)
  if (!config.generationModel || !ALLOWED_MODELS.has(config.generationModel)) {
    errors.push(`Invalid generation model: "${config.generationModel ?? ''}". Allowed: ${[...ALLOWED_MODELS].join(', ')}`);
  }
  if (!config.judgeModel || !ALLOWED_MODELS.has(config.judgeModel)) {
    errors.push(`Invalid judge model: "${config.judgeModel ?? ''}". Allowed: ${[...ALLOWED_MODELS].join(', ')}`);
  }

  validateAgents(config.enabledAgents, errors);

  // Iterations
  if (config.maxIterations <= 0) {
    errors.push(`maxIterations must be > 0, got ${config.maxIterations}`);
  }

  // Budget total
  if (!config.budgetCapUsd || config.budgetCapUsd <= 0) {
    errors.push(`Budget cap must be > 0, got ${config.budgetCapUsd}`);
  }
  if (!Number.isFinite(config.budgetCapUsd)) {
    errors.push(`Budget cap must be finite, got ${config.budgetCapUsd}`);
  }

  // Supervisor constraints (only when expansion is enabled)
  if (config.expansion.maxIterations > 0) {
    if (config.expansion.minPool < 5) {
      errors.push(`Expansion minPool must be >= 5, got ${config.expansion.minPool}`);
    }
    if (config.maxIterations <= config.expansion.maxIterations) {
      errors.push(`maxIterations (${config.maxIterations}) must be > expansion.maxIterations (${config.expansion.maxIterations})`);
    }
    if (config.expansion.diversityThreshold < 0 || config.expansion.diversityThreshold > 1) {
      errors.push(`Expansion diversityThreshold must be in [0, 1], got ${config.expansion.diversityThreshold}`);
    }
  }

  // Nested object bounds
  if (config.generation.strategies <= 0) {
    errors.push(`Generation strategies must be > 0, got ${config.generation.strategies}`);
  }
  if (config.calibration.opponents <= 0) {
    errors.push(`Calibration opponents must be > 0, got ${config.calibration.opponents}`);
  }
  if (config.tournament.topK <= 0) {
    errors.push(`Tournament topK must be > 0, got ${config.tournament.topK}`);
  }

  return { valid: errors.length === 0, errors };
}
