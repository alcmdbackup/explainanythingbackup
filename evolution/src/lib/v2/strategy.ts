// Forked strategy config utilities for V2. Operates on V2StrategyConfig (no Zod/AgentName deps).

import { createHash } from 'crypto';
import type { V2StrategyConfig } from './types';

// ─── Internal helpers ────────────────────────────────────────────

/** Shorten a model name for display (e.g. "gpt-4.1-mini" -> "4.1-mini"). */
function shortenModel(model: string): string {
  return model
    .replace('gpt-', '')
    .replace('deepseek-', 'ds-')
    .replace('claude-', 'cl-');
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Generate a stable 12-char hash for a V2 strategy config.
 * Hashes ONLY: generationModel, judgeModel, iterations.
 * V2-only fields (strategiesPerRound, budgetUsd) are excluded from hash.
 */
export function hashStrategyConfig(config: V2StrategyConfig): string {
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    iterations: config.iterations,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
}

/** Auto-generated label: "Gen: model | Judge: model | N iters". */
export function labelStrategyConfig(config: V2StrategyConfig): string {
  const parts = [
    `Gen: ${shortenModel(config.generationModel)}`,
    `Judge: ${shortenModel(config.judgeModel)}`,
    `${config.iterations} iters`,
  ];

  if (config.budgetUsd != null) {
    parts.push(`Budget: $${config.budgetUsd.toFixed(2)}`);
  }

  return parts.join(' | ');
}
