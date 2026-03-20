/**
 * Data-driven cost estimation for evolution runs.
 * Uses historical LLM call data to predict run costs with scaling by text length.
 * Falls back to heuristic calculation when insufficient baseline data.
 */

import { z } from 'zod';
import { calculateLLMCost } from '@/config/llmPricing';
import type { AllowedLLMModelType } from '@/lib/schemas/schemas';
import type { EvolutionConfig } from '../v2/types';
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

// ─── Baseline Fetching ──────────────────────────────────────────

/**
 * Fetch cost baseline for a specific agent/model combo.
 * Returns null if no baseline exists or sample size is insufficient.
 */
export async function getAgentBaseline(
  _agentName: string,
  _model: string
): Promise<CostBaseline | null> {
  // V2: evolution_agent_cost_baselines table dropped. Heuristic fallback used.
  return null;
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
  const baselineCount = baselines.filter(b => b && b.sampleSize >= 50).length;
  const confidence: 'high' | 'medium' | 'low' =
    baselineCount >= 2 ? 'high' : baselineCount >= 1 ? 'medium' : 'low';

  return { totalUsd, perAgent, perIteration, confidence };
}

/**
 * Estimate run cost using V2 EvolutionConfig.
 */
export async function estimateRunCost(
  config: EvolutionConfig,
  textLength: number
): Promise<RunCostEstimate> {
  return estimateRunCostWithAgentModels({
    generationModel: config.generationModel as AllowedLLMModelType,
    judgeModel: config.judgeModel as AllowedLLMModelType,
    maxIterations: config.iterations,
    calibrationOpponents: config.calibrationOpponents,
  }, textLength);
}

// ─── Baseline Refresh ───────────────────────────────────────────

/**
 * Refresh agent cost baselines from llmCallTracking data.
 * Should be run periodically (e.g., daily) to update baseline estimates.
 */
export async function refreshAgentCostBaselines(
  _lookbackDays: number = 30
): Promise<{ updated: number; errors: string[]; skipped?: boolean }> {
  // V2: evolution_agent_cost_baselines table dropped.
  return { updated: 0, errors: [] };
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
