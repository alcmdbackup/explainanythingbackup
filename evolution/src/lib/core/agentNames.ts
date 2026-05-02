// Typed agent name union and per-purpose cost-metric lookup for the evolution pipeline.
// Tightens the second arg of llm.complete() so typos can't silently route cost to a phantom bucket.

import type { MetricName } from '../metrics/types';

// All four labels are valid AgentName values so the typed parameter accepts every
// current call site (incl. seed-phase calls in generateSeedArticle.ts which still
// need 'seed_title'/'seed_article'). Only generation and ranking get persisted as
// dedicated cost metrics — seed-phase costs roll up into the run's overall `cost`.
export const AGENT_NAMES = ['generation', 'ranking', 'reflection', 'seed_title', 'seed_article', 'evolution'] as const;
export type AgentName = typeof AGENT_NAMES[number];

/**
 * Maps each agent label to its run-level per-purpose cost metric.
 *
 * B027: `seed_title` and `seed_article` both map to `seed_cost` by design — the run-level
 * metric reports total seed cost as a single number. The calibration-table layer
 * (`evolution/scripts/refreshCostCalibration.ts` and `costCalibrationLoader.ts`) DOES
 * keep phase distinction — the calibration key includes the phase name so `seed_title`
 * and `seed_article` have separate calibration rows. No conflation at the estimation layer.
 */
export const COST_METRIC_BY_AGENT: Partial<Record<AgentName, MetricName>> = {
  generation: 'generation_cost',
  ranking: 'ranking_cost',
  reflection: 'reflection_cost',
  seed_title: 'seed_cost',
  seed_article: 'seed_cost',
};
