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
import { REQUIRED_AGENTS, OPTIONAL_AGENTS, SINGLE_ARTICLE_DISABLED } from './budgetRedistribution';

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
  ranking?: AllowedLLMModelType;
  treeSearch?: AllowedLLMModelType;
  outlineGeneration?: AllowedLLMModelType;
  sectionDecomposition?: AllowedLLMModelType;
  flowCritique?: AllowedLLMModelType;
}

interface RunCostConfig {
  generationModel?: AllowedLLMModelType;
  judgeModel?: AllowedLLMModelType;
  maxIterations?: number;
  agentModels?: AgentModels;
  /** Optional agents the user chose to enable. When undefined, all agents are estimated. */
  enabledAgents?: string[];
  /** When true, agents in SINGLE_ARTICLE_DISABLED are skipped. */
  singleArticle?: boolean;
  /** Number of calibration opponents per new entrant (default 3). */
  calibrationOpponents?: number;
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
      .from('evolution_agent_cost_baselines')
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

// ─── Text Length Growth ─────────────────────────────────────────

/** Estimate text length at a given iteration with 4% compound growth per iteration. */
export function estimateTextLengthAtIteration(baseLength: number, iteration: number): number {
  return baseLength * Math.pow(1.04, iteration);
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

  // Determine which agents are active based on enabledAgents and singleArticle
  const requiredSet = new Set<string>(REQUIRED_AGENTS);
  const optionalSet = new Set<string>(OPTIONAL_AGENTS);
  const enabledSet = config.enabledAgents ? new Set<string>(config.enabledAgents) : null;
  const singleArticleDisabledSet = config.singleArticle ? new Set<string>(SINGLE_ARTICLE_DISABLED) : null;

  const isActive = (agentName: string): boolean => {
    // singleArticle disables specific agents regardless of required/optional
    if (singleArticleDisabledSet?.has(agentName)) return false;
    // Required agents are always active (unless singleArticle disabled them above)
    if (requiredSet.has(agentName)) return true;
    // If enabledAgents not specified, all agents are active (backward compat)
    if (!enabledSet) return true;
    // Optional agents only active if in enabledAgents
    if (optionalSet.has(agentName)) return enabledSet.has(agentName);
    // Unknown agents: include by default
    return true;
  };

  const perAgent: Record<string, number> = {};

  // Sum cost across an iteration range with 4% compound text growth per iteration
  async function sumOverIterations(
    agent: keyof AgentModels, isJudge: boolean, startIter: number, endIter: number, callsPerIter: number,
  ): Promise<number> {
    let total = 0;
    for (let i = startIter; i < endIter; i++) {
      total += await estimateAgentCost(agent, getModel(agent, isJudge), estimateTextLengthAtIteration(textLength, i), callsPerIter);
    }
    return total;
  }

  // Text-scaling generation agents: sum costs with 4% compound growth
  const textScalingAgents: Array<{ agent: keyof AgentModels; startIter: number; callsPerIter: number }> = [
    { agent: 'generation', startIter: 0, callsPerIter: 3 },           // 3 strategies per iteration
    { agent: 'evolution', startIter: expansionIters, callsPerIter: 3 },  // 3 mutations per competition iter
    { agent: 'reflection', startIter: expansionIters, callsPerIter: 3 }, // 3 reviews per competition iter
    { agent: 'debate', startIter: expansionIters, callsPerIter: 4 },     // 2 advocates + judge + synthesis
    { agent: 'iterativeEditing', startIter: expansionIters, callsPerIter: 6 }, // 2 dimensions × 3 passes
  ];

  for (const { agent, startIter, callsPerIter } of textScalingAgents) {
    if (isActive(agent)) {
      perAgent[agent] = await sumOverIterations(agent, false, startIter, iterations, callsPerIter);
    }
  }

  // Judge agents (use judgeModel as default)
  // Ranking: triage (calibration opponents × entrants × 2 directions) + fine-ranking (Swiss tournament)
  if (isActive('ranking')) {
    const opponents = config.calibrationOpponents ?? 3;
    const triageCallsExp = opponents * 3 * 2;   // 3 new entrants in expansion
    const triageCallsComp = opponents * 5 * 2;  // 5 new entrants in competition
    const fineRankingCalls = 25 * 2;             // Swiss tournament: 25 matches × 2 directions
    // Baseline lookup: try 'ranking' first, fall back to 'calibration' or 'tournament' for old data
    const rankingModel = getModel('ranking', true);
    const triageCost =
      await estimateAgentCost('ranking', rankingModel, textLength * 2, triageCallsExp) * expansionIters +
      await estimateAgentCost('ranking', rankingModel, textLength * 2, triageCallsComp) * competitionIters;
    const fineRankingCost = await estimateAgentCost('ranking', rankingModel, textLength * 2, fineRankingCalls) * competitionIters;
    perAgent.ranking = triageCost + fineRankingCost;
  }

  // treeSearch: K*B*D gen + K*(D-1) re-crit + 30*D eval (K=3, B=3, D=3)
  // gen = 3*3*3 = 27, re-crit = 3*(3-1) = 6, eval = 30*3 = 90 → total judge ≈ 96
  if (isActive('treeSearch')) {
    perAgent.treeSearch = (
      await estimateAgentCost('treeSearch', getModel('treeSearch', false), textLength, 27) +
      await estimateAgentCost('treeSearch', getModel('treeSearch', true), textLength * 2, 96)
    ) * competitionIters;
  }

  // outlineGeneration: 3 gen calls + 3 judge calls per competition iteration
  // (outline→score→expand→score→polish→score pipeline)
  if (isActive('outlineGeneration')) {
    perAgent.outlineGeneration = (
      await estimateAgentCost('outlineGeneration', getModel('outlineGeneration', false), textLength, 3) +
      await estimateAgentCost('outlineGeneration', getModel('outlineGeneration', true), textLength, 3)
    ) * competitionIters;
  }

  // sectionDecomposition: ~10 gen calls + ~10 judge calls per competition iteration
  // (~5 sections × 2 cycles × 1 edit + 1 judge per cycle)
  if (isActive('sectionDecomposition')) {
    perAgent.sectionDecomposition = (
      await estimateAgentCost('sectionDecomposition', getModel('sectionDecomposition', false), textLength / 5, 10) +
      await estimateAgentCost('sectionDecomposition', getModel('sectionDecomposition', true), textLength / 5, 10)
    ) * competitionIters;
  }

  // flowCritique: ~15 judge calls per competition iteration (1 per pool variant, pool ~15 in competition)
  // Uses judge model since flowCritique runs compareFlowWithBiasMitigation (2-pass judge LLM calls)
  if (isActive('flowCritique')) {
    perAgent.flowCritique = await estimateAgentCost(
      'flowCritique', getModel('flowCritique', true), textLength, 15
    ) * competitionIters;
  }

  const totalUsd = Object.values(perAgent).reduce((a, b) => a + b, 0);
  const perIteration = totalUsd / iterations;

  // Determine confidence based on baseline sample sizes
  const baselines = await Promise.all([
    getAgentBaseline('generation', getModel('generation', false)),
    getAgentBaseline('ranking', getModel('ranking', true)),
  ]);
  const hasBaselines = baselines.filter(b => b && b.sampleSize >= 50).length;
  let confidence: 'high' | 'medium' | 'low';
  if (hasBaselines >= 2) confidence = 'high';
  else if (hasBaselines >= 1) confidence = 'medium';
  else confidence = 'low';

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
    enabledAgents: config.enabledAgents,
    singleArticle: config.singleArticle,
    calibrationOpponents: config.calibration?.opponents,
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

    const sum = (arr: number[]): number => arr.reduce((a, b) => a + b, 0);

    // Upsert baselines for combos with sufficient samples
    for (const [key, stats] of aggregates) {
      const [agentName, model] = key.split(':');
      const sampleSize = stats.costs.length;

      if (sampleSize < 10) continue;

      const { error: upsertError } = await supabase
        .from('evolution_agent_cost_baselines')
        .upsert({
          agent_name: agentName,
          model,
          avg_prompt_tokens: stats.promptTokens.length > 0 ? Math.round(sum(stats.promptTokens) / stats.promptTokens.length) : null,
          avg_completion_tokens: stats.completionTokens.length > 0 ? Math.round(sum(stats.completionTokens) / stats.completionTokens.length) : null,
          avg_cost_usd: sum(stats.costs) / stats.costs.length,
          avg_text_length: stats.promptTokens.length > 0 ? Math.round(sum(stats.promptTokens) / stats.promptTokens.length * 4) : null,
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
 * actualTotalUsd and perAgentCosts are queried from the invocations table by the caller.
 */
export function computeCostPrediction(
  estimated: RunCostEstimate,
  actualTotalUsd: number,
  perAgentCosts: Record<string, number>,
): CostPrediction {
  const deltaUsd = actualTotalUsd - estimated.totalUsd;
  const deltaPercent = estimated.totalUsd > 0 ? (deltaUsd / estimated.totalUsd) * 100 : 0;

  const perAgent: Record<string, { estimated: number; actual: number }> = {};
  const allAgents = new Set([
    ...Object.keys(estimated.perAgent),
    ...Object.keys(perAgentCosts),
  ]);
  for (const agent of allAgents) {
    perAgent[agent] = {
      estimated: estimated.perAgent[agent] ?? 0,
      actual: perAgentCosts[agent] ?? 0,
    };
  }

  return {
    estimatedUsd: estimated.totalUsd,
    actualUsd: actualTotalUsd,
    deltaUsd,
    deltaPercent,
    confidence: estimated.confidence,
    perAgent,
  };
}
