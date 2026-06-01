// V2 LLM client wrapper with retry on transient errors and cost tracking integration.
// Writes cost metrics to DB after each successful LLM call (fire-and-forget) so cost
// survives sudden process crashes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvolutionLLMClient, LLMCompletionOptions } from '../../types';
import { BudgetExceededError } from '../../types';
import { isTransientError } from '../../shared/classifyErrors';
import { getModelPricing, calculateLLMCost, type ModelPricing } from '@/config/llmPricing';
import type { V2CostTracker } from './trackBudget';
import type { EntityLogger } from './createEntityLogger';
import { writeMetricMax } from '../../metrics/writeMetrics';
import { type AgentName, COST_METRIC_BY_AGENT } from '../../core/agentNames';
import { getCalibrationRow } from './costCalibrationLoader';
// Phase 1 (rename_agents_subagents_evolution_20260508): wrap each LLM call in a child active
// span. Combined with the agent.<name> active span opened in Agent.run(), Honeycomb traces
// show the full agent → subagent (per-LLM-call) hierarchy. Imports from the leaf
// `lib/observability/withActiveSpan` (not the top-level `instrumentation.ts`) so the
// pipeline doesn't drag server-only chunks into client bundles — see Agent.ts for details.
import { withActiveSpan } from '../../observability/withActiveSpan';

// ─── Cost estimation ─────────────────────────────────────────────

/** Calculate cost from character counts (chars/4 ≈ tokens for English text). Rounded to 6 decimal places. */
export function calculateCost(inputChars: number, outputChars: number, pricing: ModelPricing): number {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);
  const rawCost = (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
  return Math.round(rawCost * 1_000_000) / 1_000_000;
}

// ─── Constants ───────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const PER_CALL_TIMEOUT_MS = 60_000;

/** Estimated output tokens by label. Keys must be valid AgentName values. */
const OUTPUT_TOKEN_ESTIMATES: Partial<Record<AgentName, number>> = {
  generation: 1000,
  ranking: 100,
  // Reflection: top-3 ranked tactics × ~200 tokens reasoning each ≈ 600 tokens (~2400 chars).
  reflection: 600,
  // Combined evaluate + suggest: ~150 chars score lines + ~600 tokens × weakestK suggestion
  // blocks ≈ 2300 chars typical at criteriaCount=5, weakestK=1.
  evaluate_and_suggest: 2300,
  // Proposer outputs full article verbatim with inline CriticMarkup edits — output dominated
  // by article copy + ~40% markup overhead. Tokens estimate scales with article size; 1200
  // tokens (~4800 chars) covers a typical 8K-char article with markup.
  criteria_proposer: 1200,
  // Forward approver returns JSONL: per-group {decision, reason, redundancy_violation?, ...}.
  // ~600 chars for typical N=6 groups.
  criteria_forward_approver: 150,
  // Mirror approver returns same shape on mirror-flipped groups; same estimate.
  // (Short-circuit for forward-rejected groups means actual call count may be lower.)
  criteria_mirror_approver: 150,
  // Combined analyze+judge: 9-field structured JSON with prosA/consA/prosB/consB +
  // winner/reasoning + strengthsFromA/strengthsFromB + improvements; ~600-1000 tokens
  // typical (Option C from bring_back_debate_agent_20260506 Decision §17).
  debate_judge: 800,
  // Synthesis call delegates to inner GFPA which produces a full variant.
  // Same shape as 'generation' but routed through the I4 LLM-client proxy so
  // cost flows to debate_cost instead of generation_cost.
  debate_synthesis: 2000,
  // Per-paragraph rewrite: paragraph-level output, much smaller than article-
  // level 'generation' (1000). A typical 8K-char article has ~12 paragraphs ≈
  // ~660 chars/paragraph; rewrite output ~similar size + minor variance.
  // 250 tokens (~1000 chars) covers a typical paragraph rewrite.
  paragraph_rewrite: 250,
  // Per-slot ranking: the agent relabels rankNewVariant's 'ranking' calls to
  // 'paragraph_rank' (cost-attribution fix), so it needs the same output estimate
  // as 'ranking' (100) — same pairwise-verdict shape. Without this entry the
  // reserve-before-spend path would fall back to the 1000-token default and
  // over-reserve ~10×, risking premature per-slot self-abort on the small
  // per-slot budget (~$0.033 at defaults).
  paragraph_rank: 100,
};

// ─── Public API ──────────────────────────────────────────────────

/** Token usage metadata returned alongside the response text from a provider call. */
export interface RawProviderUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  /** Cache-hit subset of promptTokens (provider context caching) — feeds the cache-aware
   *  rate in calculateLLMCost so the budget gate bills cached input correctly. */
  cachedPromptTokens?: number;
}

/** Raw provider response — legacy bare string, or new {text, usage} shape. Discriminated at runtime. */
export type RawProviderResponse = string | { text: string; usage: RawProviderUsage };

/** Raw provider shape consumed by createEvolutionLLMClient. May return either shape above. */
export interface RawLLMProvider {
  complete(
    prompt: string,
    label: AgentName,
    opts?: { model?: string; temperature?: number; reasoningEffort?: 'none' | 'low' | 'medium' | 'high'; invocationId?: string },
  ): Promise<RawProviderResponse>;
}

/**
 * Create a V2 EvolutionLLMClient wrapping a raw LLM provider with retry + cost tracking.
 * The raw provider is a simple { complete(prompt, label, opts?) } function. It may return
 * either a bare string (legacy) or `{ text, usage }` (new path — usage drives token-based
 * recordSpend in Phase 2).
 */
export function createEvolutionLLMClient(
  rawProvider: RawLLMProvider,
  costTracker: V2CostTracker,
  defaultModel: string,
  logger?: EntityLogger,
  db?: SupabaseClient,
  runId?: string,
  /** Temperature for generation calls. Ranking calls always use 0. undefined = provider default. */
  generationTemperature?: number,
  /**
   * Bound invocationId — auto-attached to every complete() call so agents that don't pass
   * `options.invocationId` per-call still get llmCallTracking rows linked back to their
   * evolution_agent_invocations row. LAST positional param: any future optional params
   * MUST use an options object instead — see plan-review note in
   * docs/planning/debug_evolution_run_cost_20260426/_planning.md § Phase 4a.
   */
  invocationId?: string,
): EvolutionLLMClient {
  return {
    async complete(
      prompt: string,
      agentName: AgentName,
      options?: LLMCompletionOptions,
    ): Promise<string> {
      // Wrap the entire complete() body in an active child span. Auto-nests under any
      // agent.<name> span the caller opened (via Agent.run()) thanks to AsyncLocalStorage.
      // The subagent.path attribute joins the parent agent's name to this LLM call's label.
      return withActiveSpan(
        `subagent.${agentName}`,
        { 'subagent.path': agentName, 'subagent.label': agentName },
        async () => {
      const model = (options?.model as string) ?? defaultModel;
      // Judge/ranking calls are deterministic (temp 0). 'paragraph_rank' is the relabeled
      // per-slot ranking judge call (ParagraphRecombineAgent relabels rankNewVariant's
      // 'ranking' → 'paragraph_rank' for cost attribution); without it here the judge would
      // fall through to the generation/provider-default temperature, breaking the 2-pass
      // reversal determinism the paragraph ranking relies on.
      const temperature = (agentName === 'ranking' || agentName === 'paragraph_rank')
        ? 0
        : (options?.temperature ?? generationTemperature);
      const reasoningEffort = options?.reasoningEffort;
      const pricing = getModelPricing(model);
      // Calibration-aware per-call estimate. When COST_CALIBRATION_ENABLED='true' and the
      // loader has a row for this (agentName, model), use avg_output_chars directly.
      // Otherwise fall back to OUTPUT_TOKEN_ESTIMATES (tokens × 4 chars/token).
      const calibrated = (() => {
        const phase = agentName === 'generation' ? 'generation'
          : agentName === 'ranking' ? 'ranking'
          : agentName === 'reflection' ? 'reflection'
          : agentName === 'seed_title' ? 'seed_title'
          : agentName === 'seed_article' ? 'seed_article'
          : agentName === 'evaluate_and_suggest' ? 'evaluate_and_suggest'
          : agentName === 'debate_judge' ? 'debate_judge'
          : agentName === 'debate_synthesis' ? 'debate_synthesis'
          : null;
        if (!phase) return null;
        return getCalibrationRow('__unspecified__', model, '__unspecified__', phase);
      })();
      const outputChars = calibrated?.avgOutputChars
        ?? (OUTPUT_TOKEN_ESTIMATES[agentName] ?? 1000) * 4;
      const estimated = calculateCost(prompt.length, outputChars, pricing);

      let lastError: Error | null = null;

      // B003-S2 + B004-S2: per-attempt reserve so the budget gate genuinely rejects on
      // retry-overspend. Each attempt: reserve → call provider → on success recordSpend
      // (closing this attempt's reservation), on transient error release (returns this
      // attempt's margin to the pool, retry will re-reserve), on permanent error release
      // and throw. Empty-response is treated identically to a transient (reserve already
      // covered the billed call; release returns the margin so the next attempt — or
      // the final throw — can re-reserve cleanly).
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        let timeoutId: NodeJS.Timeout | undefined;
        // Reserve before each attempt — if budget can't cover it, BudgetExceededError fires
        // BEFORE we hit the provider, so retries can't sneak past the cap.
        let margined: number;
        try {
          margined = costTracker.reserve(agentName, estimated);
        } catch (err) {
          if (err instanceof BudgetExceededError) {
            logger?.error('Budget exceeded on retry attempt', { phaseName: agentName, attempt });
            throw err;
          }
          throw err;
        }
        try {
          logger?.debug('LLM call attempt', { phaseName: agentName, attempt, model });
          const rawResponse = await Promise.race([
            rawProvider.complete(prompt, agentName, { model, temperature, reasoningEffort, invocationId: options?.invocationId ?? invocationId }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error('LLM call timeout (60s)')), PER_CALL_TIMEOUT_MS);
            }),
          ]);

          // Discriminate raw-provider shape: bare string (legacy) vs {text, usage} (new).
          const response: string = typeof rawResponse === 'string' ? rawResponse : rawResponse.text;
          const usage: RawProviderUsage | null = typeof rawResponse === 'string' ? null : rawResponse.usage;

          // Validate response is a non-empty string. B004-S2: provider was BILLED for this
          // call even though the response is empty — record the actual cost (so the tracker
          // matches reality) before throwing. The throw will retry or fail downstream.
          if (typeof response !== 'string' || response.trim().length === 0) {
            const billedActual = usage && Number.isFinite(usage.promptTokens) && Number.isFinite(usage.completionTokens)
              ? calculateLLMCost(model, usage.promptTokens, usage.completionTokens, usage.reasoningTokens ?? 0, usage.cachedPromptTokens ?? 0)
              : calculateCost(prompt.length, 0, pricing);
            costTracker.recordSpend(agentName, billedActual, margined);
            throw new Error('Empty LLM response');
          }

          // Success — record actual cost.
          const actual = usage && Number.isFinite(usage.promptTokens) && Number.isFinite(usage.completionTokens)
            ? calculateLLMCost(model, usage.promptTokens, usage.completionTokens, usage.reasoningTokens ?? 0, usage.cachedPromptTokens ?? 0)
            : calculateCost(prompt.length, response.length, pricing);
          costTracker.recordSpend(agentName, actual, margined);

          // B005-S2 (reverted): cost-write was switched to fire-and-forget for hot-path
          // perf, but the integration tests rely on metric values being visible
          // immediately after the LLM call returns (they read evolution_metrics
          // synchronously in the same await). Restore awaited writes; re-evaluate the
          // perf optimization in a follow-up that pairs it with test changes.
          // B015-S2: read totalSpent/phaseCost INSIDE try so a tracker that throws
          // doesn't surface as a successful-then-throw.
          // B013-S2 (intentional): getTotalSpent/getPhaseCosts read SHARED aggregate;
          // under parallel dispatch GREATEST resolves the racing writes correctly.
          if (db && runId) {
            try {
              const totalSpent = costTracker.getTotalSpent();
              const phaseCost = costTracker.getPhaseCosts()[agentName] ?? 0;
              await writeMetricMax(db, 'run', runId, 'cost', totalSpent, 'during_execution');
              const costMetricName = COST_METRIC_BY_AGENT[agentName];
              if (costMetricName) {
                await writeMetricMax(db, 'run', runId, costMetricName, phaseCost, 'during_execution');
              }
            } catch (err) {
              logger?.warn('Cost write failed (non-fatal)', { phaseName: agentName, error: err instanceof Error ? err.message : String(err) });
            }
          }

          logger?.info('LLM call succeeded', {
            phaseName: agentName,
            promptChars: prompt.length,
            responseChars: response.length,
            promptTokens: usage?.promptTokens ?? null,
            completionTokens: usage?.completionTokens ?? null,
            costSource: usage ? 'usage' : 'chars',
            costUsd: actual,
            attempt,
          });
          return response;
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            // Budget errors are NOT retried. Release THIS attempt's reservation since the
            // call didn't proceed (recordSpend wasn't called above).
            costTracker.release(agentName, margined);
            logger?.error('Budget exceeded in LLM call', { phaseName: agentName });
            throw error;
          }

          lastError = error instanceof Error ? error : new Error(String(error));

          // For empty-response, recordSpend was already called above — nothing to release.
          // For other errors, release this attempt's reservation so it doesn't pin budget.
          const isEmptyResponseRecorded = lastError.message === 'Empty LLM response';
          if (!isEmptyResponseRecorded) {
            costTracker.release(agentName, margined);
          }

          if (!isTransientError(error) || attempt === MAX_RETRIES) {
            logger?.error('LLM call failed', { phaseName: agentName, totalAttempts: attempt + 1, error: lastError.message.slice(0, 500) });
            throw lastError;
          }

          logger?.warn('LLM transient error', { phaseName: agentName, attempt, error: lastError.message.slice(0, 500) });
          await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      }

      // Should not reach here, but safety net
      throw lastError ?? new Error('LLM call failed after retries');
        },
      );
    },

    async completeStructured(): Promise<never> {
      throw new Error('completeStructured not supported in V2');
    },
  };
}
