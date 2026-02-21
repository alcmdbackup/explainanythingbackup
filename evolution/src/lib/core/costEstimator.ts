/**
 * Data-driven cost estimation for evolution runs.
 * Uses historical LLM call data to predict run costs with scaling by text length.
 * Falls back to heuristic calculation when insufficient baseline data.
 */

import { z } from 'zod';
import { calculateLLMCost } from '@/config/llmPricing';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { EvolutionRunConfig } from '../types';
import { EVOLUTION_DEFAULT_MODEL } from './llmClient';

// ─── Baseline Types ─────────────────────────────────────────────

export interface CostBaseline {
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgCostUsd: number;
  avgTextLength: number;
  sampleSize: number;
}

export interface RunCostEstimate {
  totalUsd: number;
  perAgent: Record<string, number>;
  perIteration: number;
  confidence: 'high' | 'medium' | 'low';
}

export const RunCostEstimateSchema = z.object({
  totalUsd: z.number(),
  perAgent: z.record(z.number()),
  perIteration: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
});

// Per-agent model configuration (matches batch config schema)
interface AgentModels {
  generation?: AllowedLLMModelType;
  evolution?: AllowedLLMModelType;
  reflection?: AllowedLLMModelType;
  debate?: AllowedLLMModelType;
  iterativeEditing?: AllowedLLMModelType;
  calibration?: AllowedLLMModelType;
  tournament?: AllowedLLMModelType;
}

interface RunCostConfig {
  generationModel?: AllowedLLMModelType;
  judgeModel?: AllowedLLMModelType;
  maxIterations?: number;
  agentModels?: AgentModels;
  /** CFG-1: Per-agent budget caps — used to clamp estimated per-agent costs. */
  budgetCaps?: Record<string, number>;
}

// ─── Baseline Cache ─────────────────────────────────────────────

// In-memory cache for baselines (refreshed per-process)
const baselineCache = new Map<string, CostBaseline>();
const BASELINE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let lastCacheRefresh = 0;

function clearCacheIfStale(): void {
  if (Date.now() - lastCacheRefresh > BASELINE_CACHE_TTL_MS) {
    baselineCache.clear();
  }
}

// ─── Baseline Fetching ──────────────────────────────────────────

/**
 * Fetch cost baseline for a specific agent/model combo.
 * Returns null if no baseline exists or sample size is insufficient.
 */
export async function getAgentBaseline(
  agentName: string,
  model: string
): Promise<CostBaseline | null> {
  clearCacheIfStale();

  const key = `${agentName}:${model}`;
  if (baselineCache.has(key)) return baselineCache.get(key)!;

  try {
    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase
      .from('agent_cost_baselines')
      .select('*')
      .eq('agent_name', agentName)
      .eq('model', model)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // No rows found — expected for new combos
      throw new Error(`Failed to fetch baseline for ${agentName}/${model}: ${error.message}`);
    }

    if (!data || data.sample_size < 50) return null;

    const baseline: CostBaseline = {
      avgPromptTokens: data.avg_prompt_tokens ?? 1000,
      avgCompletionTokens: data.avg_completion_tokens ?? 500,
      avgCostUsd: data.avg_cost_usd ?? 0.001,
      avgTextLength: data.avg_text_length ?? 5000,
      sampleSize: data.sample_size,
    };
    baselineCache.set(key, baseline);
    lastCacheRefresh = Date.now();
    return baseline;
  } catch {
    return null;
  }
}

// ─── Cost Estimation ────────────────────────────────────────────

/**
 * Estimate cost for a single agent call.
 * Uses baseline data if available, falls back to heuristic.
 */
export async function estimateAgentCost(
  agentName: string,
  model: string,
  textLength: number,
  callMultiplier: number = 1
): Promise<number> {
  const baseline = await getAgentBaseline(agentName, model);

  if (baseline) {
    const textRatio = textLength / (baseline.avgTextLength || 1);
    return baseline.avgCostUsd * textRatio * callMultiplier;
  }

  // Fallback: heuristic — ~1 token per 4 chars + system prompt overhead
  const tokens = Math.ceil(textLength / 4);
  return calculateLLMCost(model, tokens + 200, tokens) * callMultiplier;
}

/**
 * Estimate total run cost with support for per-agent model overrides.
 * Each agent uses: agentModels[agent] ?? (isJudgeAgent ? judgeModel : generationModel)
 */
export async function estimateRunCostWithAgentModels(
  config: RunCostConfig,
  textLength: number
): Promise<RunCostEstimate> {
  const defaultGenModel = config.generationModel ?? EVOLUTION_DEFAULT_MODEL;
  const defaultJudgeModel = config.judgeModel ?? 'gpt-4.1-nano';
  const agentModels = config.agentModels ?? {};
  const iterations = config.maxIterations ?? 15;

  // Expansion phase is first min(8, iterations) iterations
  const expansionIters = Math.min(8, iterations);
  const competitionIters = iterations - expansionIters;

  // Resolve model for each agent (override or default)
  const getModel = (agent: keyof AgentModels, isJudge: boolean): string => {
    return agentModels[agent] ?? (isJudge ? defaultJudgeModel : defaultGenModel);
  };

  const perAgent: Record<string, number> = {};

  // Generation agents (use generationModel as default)
  // Generation: 3 strategies per iteration
  perAgent.generation = await estimateAgentCost(
    'generation', getModel('generation', false), textLength, 3
  ) * iterations;

  // Evolution: 3 mutations per competition iteration
  perAgent.evolution = await estimateAgentCost(
    'evolution', getModel('evolution', false), textLength, 3
  ) * competitionIters;

  // Reflection: 3 reviews per competition iteration
  perAgent.reflection = await estimateAgentCost(
    'reflection', getModel('reflection', false), textLength, 3
  ) * competitionIters;

  // Debate: 4 calls per debate (2 advocates + judge + synthesis)
  perAgent.debate = await estimateAgentCost(
    'debate', getModel('debate', false), textLength, 4
  ) * competitionIters;

  // Iterative Editing: 6 edit calls per iteration (2 dimensions × 3 passes)
  perAgent.iterativeEditing = await estimateAgentCost(
    'iterativeEditing', getModel('iterativeEditing', false), textLength, 6
  ) * competitionIters;

  // Judge agents (use judgeModel as default)
  // Calibration: 3 opponents × 3 newEntrants × 2 directions = 18 calls in expansion
  //              3 opponents × 5 newEntrants × 2 directions = 30 calls in competition
  const calibrationCallsExp = 3 * 3 * 2;
  const calibrationCallsComp = 3 * 5 * 2;
  perAgent.calibration =
    await estimateAgentCost('calibration', getModel('calibration', true), textLength * 2, calibrationCallsExp) * expansionIters +
    await estimateAgentCost('calibration', getModel('calibration', true), textLength * 2, calibrationCallsComp) * competitionIters;

  // Tournament: 25 matches × 2 directions = 50 calls per competition iteration
  perAgent.tournament = await estimateAgentCost(
    'tournament', getModel('tournament', true), textLength * 2, 25 * 2
  ) * competitionIters;

  // CFG-1: Clamp per-agent estimated costs by budgetCaps when provided
  if (config.budgetCaps) {
    for (const [agent, cap] of Object.entries(config.budgetCaps)) {
      if (agent in perAgent && perAgent[agent] > cap) {
        perAgent[agent] = cap;
      }
    }
  }

  const totalUsd = Object.values(perAgent).reduce((a, b) => a + b, 0);
  const perIteration = totalUsd / iterations;

  // Determine confidence based on baseline sample sizes
  const baselines = await Promise.all([
    getAgentBaseline('generation', getModel('generation', false)),
    getAgentBaseline('calibration', getModel('calibration', true)),
  ]);
  const hasBaselines = baselines.filter(b => b && b.sampleSize >= 50).length;
  const confidence = hasBaselines >= 2 ? 'high' : hasBaselines >= 1 ? 'medium' : 'low';

  return { totalUsd, perAgent, perIteration, confidence };
}

/**
 * Estimate run cost using EvolutionRunConfig.
 * Backward-compatible wrapper for estimateRunCostWithAgentModels.
 */
export async function estimateRunCost(
  config: EvolutionRunConfig,
  textLength: number
): Promise<RunCostEstimate> {
  return estimateRunCostWithAgentModels({
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    maxIterations: config.maxIterations,
  }, textLength);
}

// ─── Baseline Refresh ───────────────────────────────────────────

/**
 * Refresh agent cost baselines from llmCallTracking data.
 * Should be run periodically (e.g., daily) to update baseline estimates.
 */
// Advisory lock ID for refreshAgentCostBaselines (arbitrary stable int)
const BASELINE_REFRESH_LOCK_ID = 8675309;

export async function refreshAgentCostBaselines(
  lookbackDays: number = 30
): Promise<{ updated: number; errors: string[]; skipped?: boolean }> {
  const supabase = await createSupabaseServiceClient();

  // Acquire advisory lock — skip if another call is already running
  let lockAcquired = false;
  try {
    const { data: lockResult } = await supabase.rpc('pg_try_advisory_lock', { lock_id: BASELINE_REFRESH_LOCK_ID });
    lockAcquired = !!lockResult;
  } catch {
    // RPC failed (e.g., connection issue) — skip gracefully
    return { updated: 0, errors: ['Advisory lock acquisition failed'], skipped: true };
  }
  if (!lockAcquired) {
    return { updated: 0, errors: [], skipped: true };
  }

  const errors: string[] = [];
  let updated = 0;

  try {
    const lookbackDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('llmCallTracking')
      .select('call_source, model, prompt_tokens, completion_tokens, estimated_cost_usd')
      .like('call_source', 'evolution_%')
      .gte('created_at', lookbackDate);

    if (error) {
      return { updated: 0, errors: [`Failed to fetch LLM tracking data: ${error.message}`] };
    }

    if (!data?.length) {
      return { updated: 0, errors: ['No evolution LLM calls found in lookback period'] };
    }

    // Aggregate by agent/model
    const aggregates = new Map<string, {
      promptTokens: number[];
      completionTokens: number[];
      costs: number[];
    }>();

    for (const row of data) {
      const agentName = row.call_source?.replace(/^evolution_/, '') ?? 'unknown';
      const key = `${agentName}:${row.model}`;
      const existing = aggregates.get(key) ?? { promptTokens: [], completionTokens: [], costs: [] };
      if (row.prompt_tokens) existing.promptTokens.push(row.prompt_tokens);
      if (row.completion_tokens) existing.completionTokens.push(row.completion_tokens);
      if (row.estimated_cost_usd) existing.costs.push(row.estimated_cost_usd);
      aggregates.set(key, existing);
    }

    // Upsert baselines for combos with sufficient samples
    for (const [key, stats] of aggregates) {
      const [agentName, model] = key.split(':');
      const sampleSize = stats.costs.length;

      if (sampleSize < 10) continue;

      const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);
      const { error: upsertError } = await supabase
        .from('agent_cost_baselines')
        .upsert({
          agent_name: agentName,
          model,
          avg_prompt_tokens: Math.round(sum(stats.promptTokens) / stats.promptTokens.length),
          avg_completion_tokens: Math.round(sum(stats.completionTokens) / stats.completionTokens.length),
          avg_cost_usd: sum(stats.costs) / stats.costs.length,
          sample_size: sampleSize,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'agent_name,model' });

      if (upsertError) {
        errors.push(`Failed to upsert baseline for ${key}: ${upsertError.message}`);
      } else {
        updated++;
      }
    }

    baselineCache.clear();
    return { updated, errors };
  } finally {
    // Release advisory lock (best-effort)
    try {
      await supabase.rpc('pg_advisory_unlock', { lock_id: BASELINE_REFRESH_LOCK_ID });
    } catch {
      // Ignore unlock failures — lock released on connection close anyway
    }
  }
}

// ─── Cost Prediction Tracking ───────────────────────────────────

export interface CostPrediction {
  estimatedUsd: number;
  actualUsd: number;
  deltaUsd: number;
  deltaPercent: number;
  confidence: 'high' | 'medium' | 'low';
  perAgent: Record<string, { estimated: number; actual: number }>;
}

export const CostPredictionSchema = z.object({
  estimatedUsd: z.number(),
  actualUsd: z.number(),
  deltaUsd: z.number(),
  deltaPercent: z.number(),
  confidence: z.enum(['high', 'medium', 'low']),
  perAgent: z.record(z.object({ estimated: z.number(), actual: z.number() })),
});

/**
 * Compute cost prediction delta after run completion.
 */
export function computeCostPrediction(
  estimated: RunCostEstimate,
  actualCosts: Record<string, number>
): CostPrediction {
  const actualUsd = Object.values(actualCosts).reduce((a, b) => a + b, 0);
  const deltaUsd = actualUsd - estimated.totalUsd;
  const deltaPercent = estimated.totalUsd > 0 ? (deltaUsd / estimated.totalUsd) * 100 : 0;

  const perAgent: Record<string, { estimated: number; actual: number }> = {};
  for (const agent of Object.keys(estimated.perAgent)) {
    perAgent[agent] = {
      estimated: estimated.perAgent[agent] ?? 0,
      actual: actualCosts[agent] ?? 0,
    };
  }

  return {
    estimatedUsd: estimated.totalUsd,
    actualUsd,
    deltaUsd,
    deltaPercent,
    confidence: estimated.confidence,
    perAgent,
  };
}
