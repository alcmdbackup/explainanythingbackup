// Main effects computation, interaction effects, factor ranking, and recommendation generation.
// Analyzes results from L8/full-factorial experiments to identify optimal strategy configs.

import type { ExperimentDesign, L8Design, FullFactorialDesign, MultiLevelFactor } from './factorial';
import { L8_ARRAY } from './factorial';

// ─── Types ────────────────────────────────────────────────────────

export interface ExperimentRun {
  row: number;
  runId: string;
  status: 'completed' | 'failed' | 'pending' | 'running';
  topElo?: number;
  costUsd?: number;
  baselineRank?: number;
  stopReason?: string;
  error?: string;
}

export interface MainEffects {
  elo: Record<string, number>;
  eloPerDollar: Record<string, number>;
}

export interface InteractionEffect {
  label: string;
  elo: number;
  eloPerDollar: number;
}

export interface FactorRanking {
  factor: string;
  factorLabel: string;
  eloEffect: number;
  eloPerDollarEffect: number;
  /** Absolute magnitude of Elo effect — higher = more important. */
  importance: number;
}

export interface AnalysisResult {
  mainEffects: MainEffects;
  interactions: InteractionEffect[];
  factorRanking: FactorRanking[];
  recommendations: string[];
  warnings: string[];
  completedRuns: number;
  totalRuns: number;
}

// ─── Shared Helpers ──────────────────────────────────────────────

interface ResponseMaps {
  eloByRow: Map<number, number>;
  eloPerDollarByRow: Map<number, number>;
}

/** Build per-row Elo and Elo/$ lookup maps from completed runs. */
function buildResponseMaps(runs: ExperimentRun[]): ResponseMaps {
  const eloByRow = new Map<number, number>();
  const eloPerDollarByRow = new Map<number, number>();
  for (const run of runs) {
    eloByRow.set(run.row, run.topElo!);
    const eloDollar = run.costUsd! > 0 ? (run.topElo! - 1200) / run.costUsd! : 0;
    eloPerDollarByRow.set(run.row, eloDollar);
  }
  return { eloByRow, eloPerDollarByRow };
}

/** Compute the main effect for a single L8 column: avg(high) - avg(low). */
function computeColumnEffect(
  column: number,
  responseByRow: Map<number, number>,
): number {
  let highSum = 0;
  let highCount = 0;
  let lowSum = 0;
  let lowCount = 0;

  for (let rowIdx = 0; rowIdx < L8_ARRAY.length; rowIdx++) {
    const value = responseByRow.get(rowIdx + 1);
    if (value == null) continue;

    if (L8_ARRAY[rowIdx][column] === 1) {
      highSum += value;
      highCount++;
    } else {
      lowSum += value;
      lowCount++;
    }
  }

  if (highCount === 0 || lowCount === 0) return 0;
  return highSum / highCount - lowSum / lowCount;
}

// ─── L8 Main Effects Computation ─────────────────────────────────

/**
 * Compute main effects for each factor from L8 experiment results.
 * Main effect = avg(response | factor=high) - avg(response | factor=low).
 * Computes for both Elo and Elo/$ metrics.
 */
export function computeMainEffects(
  design: L8Design,
  runs: ExperimentRun[],
): MainEffects {
  const completed = runs.filter((r) => r.status === 'completed' && r.topElo != null && r.costUsd != null);
  if (completed.length === 0) {
    return { elo: {}, eloPerDollar: {} };
  }

  const { eloByRow, eloPerDollarByRow } = buildResponseMaps(completed);
  const factorKeys = Object.keys(design.factors);

  const elo: Record<string, number> = {};
  const eloPerDollar: Record<string, number> = {};
  for (let colIdx = 0; colIdx < factorKeys.length; colIdx++) {
    const key = factorKeys[colIdx];
    elo[key] = computeColumnEffect(colIdx, eloByRow);
    eloPerDollar[key] = computeColumnEffect(colIdx, eloPerDollarByRow);
  }

  return { elo, eloPerDollar };
}

// ─── Full-Factorial Effects Computation ──────────────────────────

/**
 * Compute effect of each level relative to the grand mean for multi-level factors.
 * Returns the range (max level mean - min level mean) as the effect size per factor.
 */
export function computeFullFactorialEffects(
  design: FullFactorialDesign,
  runs: ExperimentRun[],
): MainEffects {
  const completed = runs.filter((r) => r.status === 'completed' && r.topElo != null && r.costUsd != null);
  if (completed.length === 0) {
    return { elo: {}, eloPerDollar: {} };
  }

  const { eloByRow, eloPerDollarByRow } = buildResponseMaps(completed);

  const elo: Record<string, number> = {};
  const eloPerDollar: Record<string, number> = {};

  for (const factor of design.factors) {
    elo[factor.name] = computeMultiLevelEffect(factor, design, eloByRow);
    eloPerDollar[factor.name] = computeMultiLevelEffect(factor, design, eloPerDollarByRow);
  }

  return { elo, eloPerDollar };
}

/** Compute effect range for one multi-level factor: max(level_means) - min(level_means). */
function computeMultiLevelEffect(
  factor: MultiLevelFactor,
  design: FullFactorialDesign,
  responseByRow: Map<number, number>,
): number {
  const levelMeans: number[] = [];

  for (const level of factor.levels) {
    let sum = 0;
    let count = 0;
    for (const run of design.runs) {
      if (run.factors[factor.name] === level) {
        const value = responseByRow.get(run.row);
        if (value != null) {
          sum += value;
          count++;
        }
      }
    }
    if (count > 0) levelMeans.push(sum / count);
  }

  if (levelMeans.length < 2) return 0;
  return Math.max(...levelMeans) - Math.min(...levelMeans);
}

// ─── Interaction Effects ──────────────────────────────────────────

/**
 * Compute interaction effects from unassigned L8 columns.
 * Columns 6-7 (indices 5-6) estimate A×C and A×E interactions.
 * Only applicable to L8 designs — returns empty for full-factorial.
 */
export function computeInteractionEffects(
  design: ExperimentDesign,
  runs: ExperimentRun[],
): InteractionEffect[] {
  if (design.type !== 'L8') return [];

  const completed = runs.filter((r) => r.status === 'completed' && r.topElo != null && r.costUsd != null);
  if (completed.length === 0) return [];

  const { eloByRow, eloPerDollarByRow } = buildResponseMaps(completed);

  return design.interactionColumns.map(({ label, column }) => ({
    label,
    elo: computeColumnEffect(column, eloByRow),
    eloPerDollar: computeColumnEffect(column, eloPerDollarByRow),
  }));
}

// ─── Factor Ranking ───────────────────────────────────────────────

/**
 * Rank factors by absolute Elo effect magnitude. Higher = more important.
 */
export function rankFactors(
  design: ExperimentDesign,
  mainEffects: MainEffects,
): FactorRanking[] {
  // Extract factor names and labels from either design type
  const factorEntries: { key: string; label: string }[] =
    design.type === 'L8'
      ? Object.keys(design.factors).map((k) => ({ key: k, label: design.factors[k].label }))
      : design.factors.map((f) => ({ key: f.name, label: f.label }));

  const rankings: FactorRanking[] = factorEntries.map(({ key, label }) => ({
    factor: key,
    factorLabel: label,
    eloEffect: mainEffects.elo[key] ?? 0,
    eloPerDollarEffect: mainEffects.eloPerDollar[key] ?? 0,
    importance: Math.abs(mainEffects.elo[key] ?? 0),
  }));

  return rankings.sort((a, b) => b.importance - a.importance);
}

// ─── Recommendations ──────────────────────────────────────────────

/** Resolve a factor's high/low or best level from the design. */
function getFactorLevel(
  design: ExperimentDesign,
  factorKey: string,
  direction: 'high' | 'low',
): string | number | undefined {
  if (design.type === 'L8') {
    return direction === 'high' ? design.factors[factorKey]?.high : design.factors[factorKey]?.low;
  }
  // For full-factorial, "high" = last level, "low" = first level (ordered by cost)
  const factor = design.factors.find((f) => f.name === factorKey);
  if (!factor || factor.levels.length === 0) return undefined;
  return direction === 'high' ? factor.levels[factor.levels.length - 1] : factor.levels[0];
}

/**
 * Generate actionable recommendations based on analysis results.
 */
export function generateRecommendations(
  design: ExperimentDesign,
  mainEffects: MainEffects,
  interactions: InteractionEffect[],
  factorRanking: FactorRanking[],
): string[] {
  const recs: string[] = [];

  if (factorRanking.length === 0) return ['Insufficient data for recommendations.'];

  // Top factor recommendation
  const top = factorRanking[0];
  const topDirection = top.eloEffect > 0 ? 'high' : 'low';
  const topLevel = getFactorLevel(design, top.factor, topDirection);
  recs.push(`${top.factorLabel} has the largest effect (${top.eloEffect > 0 ? '+' : ''}${Math.round(top.eloEffect)} Elo) — expand to more levels in Round 2, centered around ${topLevel}`);

  // Lock unimportant factors at cheap level
  const threshold = Math.abs(top.eloEffect) * 0.15; // <15% of top effect = negligible
  const negligible = factorRanking.filter((f) => f.importance < threshold);
  for (const f of negligible) {
    const cheapLevel = getFactorLevel(design, f.factor, f.eloPerDollarEffect >= 0 ? 'high' : 'low');
    recs.push(`Lock ${f.factorLabel} at ${cheapLevel} (negligible effect: ${Math.round(f.eloEffect)} Elo, saves cost)`);
  }

  // Elo vs Elo/$ tradeoff
  const tradeoffs = factorRanking.filter(
    (f) => f.eloEffect > threshold && f.eloPerDollarEffect < 0,
  );
  for (const f of tradeoffs) {
    recs.push(`${f.factorLabel} improves Elo (+${Math.round(f.eloEffect)}) but hurts Elo/$ (${Math.round(f.eloPerDollarEffect)}) — investigate cost-effective alternatives`);
  }

  // Interaction effects (L8 only)
  const largeInteractions = interactions.filter(
    (i) => Math.abs(i.elo) > threshold,
  );
  for (const i of largeInteractions) {
    recs.push(`Interaction ${i.label} is significant (${i.elo > 0 ? '+' : ''}${Math.round(i.elo)} Elo) — test this combination explicitly in Round 2`);
  }

  return recs;
}

// ─── Full Analysis ────────────────────────────────────────────────

/**
 * Run complete analysis on experiment results.
 * Dispatches to L8 or full-factorial computation based on design type.
 * Works with partial data (warns but computes from available rows).
 */
export function analyzeExperiment(
  design: ExperimentDesign,
  runs: ExperimentRun[],
): AnalysisResult {
  const completed = runs.filter((r) => r.status === 'completed');
  const warnings: string[] = [];

  if (completed.length < runs.length) {
    const missing = runs.length - completed.length;
    warnings.push(`${missing} of ${runs.length} runs incomplete — effects computed from partial data`);
  }

  if (completed.length < 4) {
    warnings.push('Fewer than 4 completed runs — main effects may be unreliable');
  }

  // Dispatch to appropriate effects computation
  const mainEffects = design.type === 'L8'
    ? computeMainEffects(design, runs)
    : computeFullFactorialEffects(design, runs);

  const interactions = computeInteractionEffects(design, runs);
  const factorRanking = rankFactors(design, mainEffects);
  const recommendations = generateRecommendations(design, mainEffects, interactions, factorRanking);

  return {
    mainEffects,
    interactions,
    factorRanking,
    recommendations,
    warnings,
    completedRuns: completed.length,
    totalRuns: runs.length,
  };
}
