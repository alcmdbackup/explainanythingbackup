// Unified pre-flight validation for experiment configs.
// Composes existing validators — no new validation logic, only orchestration.

import { FACTOR_REGISTRY } from './factorRegistry';
import { generateL8Design } from './factorial';
import type { FactorDefinition } from './factorial';
import { validateStrategyConfig, validateRunConfig } from '@evolution/lib/core/configValidation';
import { resolveConfig } from '@evolution/lib/config';
import type { EvolutionRunConfig } from '@evolution/lib/types';

// ─── Types ────────────────────────────────────────────────────────

export interface FactorInput {
  low: string | number;
  high: string | number;
}

export interface ExpandedRunConfig {
  row: number;
  config: EvolutionRunConfig;
}

export interface ExpandedRunConfigWithFactors extends ExpandedRunConfig {
  factors: Record<string, string | number>;
}

export interface RowCostEstimate {
  row: number;
  estimatedCostPerPrompt: number;
  totalCost: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface ExperimentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  expandedConfigs: ExpandedRunConfigWithFactors[];
  estimatedTotalCost: number;
  perRowCosts: RowCostEstimate[];
}

// ─── Cost Estimation ──────────────────────────────────────────────

const DEFAULT_ESTIMATE_TEXT_LENGTH = 5000;

/**
 * Estimate batch cost with per-row breakdown.
 * Each config × prompt gets a cost estimate; low-confidence estimates are scaled 1.5×.
 */
export async function estimateBatchCostDetailed(
  expandedConfigs: ExpandedRunConfig[],
  prompts: string[],
): Promise<{ total: number; perRow: RowCostEstimate[] }> {
  const { estimateRunCostWithAgentModels } = await import('@evolution/lib/core/costEstimator');

  let total = 0;
  const perRow: RowCostEstimate[] = [];
  for (const { row, config } of expandedConfigs) {
    const estimate = await estimateRunCostWithAgentModels(
      {
        generationModel: config.generationModel,
        judgeModel: config.judgeModel,
        maxIterations: config.maxIterations,
      },
      DEFAULT_ESTIMATE_TEXT_LENGTH,
    );
    const safetyMultiplier = estimate.confidence === 'low' ? 1.5 : 1.0;
    const estimatedCostPerPrompt = estimate.totalUsd * safetyMultiplier;
    const totalCost = estimatedCostPerPrompt * prompts.length;
    total += totalCost;
    perRow.push({ row, estimatedCostPerPrompt, totalCost, confidence: estimate.confidence });
  }
  return { total, perRow };
}

/**
 * Estimate total batch cost. Thin wrapper over estimateBatchCostDetailed.
 */
export async function estimateBatchCost(
  expandedConfigs: ExpandedRunConfig[],
  prompts: string[],
): Promise<number> {
  const { total } = await estimateBatchCostDetailed(expandedConfigs, prompts);
  return total;
}

// ─── L8 Factor Helpers ───────────────────────────────────────────

const L8_COLUMN_LETTERS = 'ABCDEFG';

/** Map user-facing factor inputs to L8 FactorDefinition columns (A-G). */
export function buildL8FactorDefinitions(
  factorDefs: Record<string, FactorInput>,
): Record<string, FactorDefinition> {
  const factorKeys = Object.keys(factorDefs);
  const result: Record<string, FactorDefinition> = {};
  for (let i = 0; i < factorKeys.length; i++) {
    const key = factorKeys[i];
    result[L8_COLUMN_LETTERS[i]] = {
      name: key,
      label: FACTOR_REGISTRY.get(key)!.label,
      low: factorDefs[key].low,
      high: factorDefs[key].high,
    };
  }
  return result;
}

// ─── Main Validation ──────────────────────────────────────────────

/**
 * Validate a full experiment configuration before starting.
 * Pipeline: registry validate -> generate L8 -> resolveConfig per row ->
 * validateStrategyConfig -> validateRunConfig -> aggregate.
 */
export async function validateExperimentConfig(
  factorDefs: Record<string, FactorInput>,
  prompts: string[],
  configDefaults?: Partial<EvolutionRunConfig>,
): Promise<ExperimentValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const factorKeys = Object.keys(factorDefs);
  if (factorKeys.length < 2) {
    errors.push(`At least 2 factors required, got ${factorKeys.length}`);
  }
  if (prompts.length === 0) {
    errors.push('At least 1 prompt is required');
  }
  if (prompts.length > 10) {
    errors.push(`Maximum 10 prompts allowed, got ${prompts.length}`);
  }

  // Validate each factor value via registry
  for (const [key, { low, high }] of Object.entries(factorDefs)) {
    const def = FACTOR_REGISTRY.get(key);
    if (!def) {
      errors.push(`Unknown factor: ${key}`);
      continue;
    }
    if (!def.validate(low)) errors.push(`Invalid ${key} low value: ${low}`);
    if (!def.validate(high)) errors.push(`Invalid ${key} high value: ${high}`);
    if (low === high) warnings.push(`Factor ${key} has identical low/high (${low}) — no effect`);
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings, expandedConfigs: [], estimatedTotalCost: 0, perRowCosts: [] };
  }

  // Generate L8 design and map to pipeline args
  const l8Factors = buildL8FactorDefinitions(factorDefs);
  const design = generateL8Design(l8Factors);
  const expandedConfigs: ExpandedRunConfigWithFactors[] = [];

  for (const run of design.runs) {
    const pipelineArgs = run.pipelineArgs;
    const overrides: Partial<EvolutionRunConfig> = {
      ...configDefaults,
      generationModel: pipelineArgs.model as EvolutionRunConfig['generationModel'],
      judgeModel: pipelineArgs.judgeModel as EvolutionRunConfig['judgeModel'],
      maxIterations: pipelineArgs.iterations,
      enabledAgents: pipelineArgs.enabledAgents as EvolutionRunConfig['enabledAgents'],
    };
    const resolved = resolveConfig(overrides);

    const stratResult = validateStrategyConfig({
      generationModel: resolved.generationModel ?? '',
      judgeModel: resolved.judgeModel ?? '',
      iterations: resolved.maxIterations,
      enabledAgents: resolved.enabledAgents,
      budgetCaps: resolved.budgetCaps,
    });
    if (!stratResult.valid) {
      errors.push(...stratResult.errors.map(e => `Row ${run.row}: ${e}`));
    }

    const runResult = validateRunConfig(resolved);
    if (!runResult.valid) {
      errors.push(...runResult.errors.map(e => `Row ${run.row}: ${e}`));
    }

    expandedConfigs.push({ row: run.row, config: resolved, factors: run.factors });
  }

  let estimatedTotalCost = 0;
  let perRowCosts: RowCostEstimate[] = [];
  if (errors.length === 0 && expandedConfigs.length > 0 && prompts.length > 0) {
    try {
      const detailed = await estimateBatchCostDetailed(expandedConfigs, prompts);
      estimatedTotalCost = detailed.total;
      perRowCosts = detailed.perRow;
    } catch {
      warnings.push('Cost estimation unavailable — estimates may be inaccurate');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    expandedConfigs,
    estimatedTotalCost,
    perRowCosts,
  };
}
