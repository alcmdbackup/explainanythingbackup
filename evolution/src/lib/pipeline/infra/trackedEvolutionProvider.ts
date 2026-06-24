// Shared tracked LLM provider for the evolution pipeline. Routes every evolution LLM call
// through the attributed `callLLM` chokepoint with fail-closed tracking (requireTracking),
// an injected Supabase client (CLI-safe), the EVOLUTION_SYSTEM_USERID, the evolution_* call_source,
// the output-token cap, and per-invocation FK threading. Extracted from claimAndExecuteRun so BOTH
// the production runner AND dev tools (run-evolution-local) share one tracked path — no direct-SDK
// bypass (llm_costs_too_low_in_dash_20260623).

import { callLLM } from '@/lib/services/llms';
import { evolutionSource } from '@/lib/services/llmCallSource';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentName } from '../../core/agentNames';
import { evolutionE2EMockResponse } from './e2eTestLlm';

/** System UUID for evolution pipeline LLM calls (llmCallTracking.userid is uuid NOT NULL). */
export const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';

/** D5 output-token cap for every evolution LLM call (see claimAndExecuteRun history). Env
 *  kill-switch: EVOLUTION_MAX_OUTPUT_TOKENS (runner restart required to pick up the change). */
export const EVOLUTION_MAX_OUTPUT_TOKENS =
  parseInt(process.env.EVOLUTION_MAX_OUTPUT_TOKENS ?? '', 10) || 4096;

export interface LLMProvider {
  complete(
    prompt: string,
    label: AgentName,
    opts?: { model?: string; temperature?: number; reasoningEffort?: 'none' | 'low' | 'medium' | 'high'; invocationId?: string },
  ): Promise<{ text: string; usage: { promptTokens: number; completionTokens: number; reasoningTokens?: number; cachedPromptTokens?: number } }>;
}

export interface TrackedEvolutionProviderOptions {
  /** Supabase client injected as trackingDb so saveLlmCallTracking doesn't fall back to the
   *  Next.js-coupled createSupabaseServiceClient (broken from CLI). */
  db: SupabaseClient;
  /** Model used when a call doesn't specify one. */
  defaultModel?: string;
  /** Output-token cap forwarded to callLLM. Defaults to EVOLUTION_MAX_OUTPUT_TOKENS. */
  maxOutputTokens?: number;
}

/**
 * Build the evolution LLM provider that routes through `callLLM` with fail-closed tracking.
 * Used by the production runner (claimAndExecuteRun) and dev tools (run-evolution-local) alike.
 */
export function createTrackedEvolutionProvider(opts: TrackedEvolutionProviderOptions): LLMProvider {
  const { db, defaultModel = 'deepseek-chat', maxOutputTokens = EVOLUTION_MAX_OUTPUT_TOKENS } = opts;
  return {
    async complete(prompt, label, callOpts) {
      // E2E_TEST_MODE (fix_test_isolation_issues_20260622): return a deterministic, LLM-free
      // response so evolution E2E/integration specs run the real pipeline with zero real-AI.
      // Synthetic non-zero usage keeps createEvolutionLLMClient's cost tracking > 0. Self-gated:
      // returns null outside E2E mode (so the runner + run-evolution-local hit the real path).
      const e2eMock = evolutionE2EMockResponse(prompt, label);
      if (e2eMock !== null) {
        return {
          text: e2eMock,
          usage: { promptTokens: Math.max(1, Math.ceil(prompt.length / 4)), completionTokens: Math.max(1, Math.ceil(e2eMock.length / 4)) },
        };
      }
      // Per-call usage capture (declared inside complete() — must NOT be hoisted to construction
      // scope or concurrent calls would clobber each other's usage).
      let capturedUsage: { promptTokens: number; completionTokens: number; reasoningTokens?: number; cachedPromptTokens?: number } | null = null;
      const text = await callLLM(
        prompt,
        evolutionSource(label),
        EVOLUTION_SYSTEM_USERID,
        allowedLLMModelSchema.parse(callOpts?.model ?? defaultModel),
        false,
        null,
        null,
        null,
        false,
        {
          temperature: callOpts?.temperature,
          reasoningEffort: callOpts?.reasoningEffort,
          trackingDb: db,
          // FAIL-CLOSED: a call whose spend can't be recorded throws (fails the run).
          requireTracking: true,
          maxOutputTokens,
          evolutionInvocationId: callOpts?.invocationId,
          onUsage: (u) => {
            capturedUsage = {
              promptTokens: u.promptTokens,
              completionTokens: u.completionTokens,
              reasoningTokens: u.reasoningTokens > 0 ? u.reasoningTokens : undefined,
              cachedPromptTokens: u.cachedPromptTokens,
            };
          },
        },
      );
      const usage = capturedUsage ?? { promptTokens: 0, completionTokens: 0 };
      return { text, usage };
    },
  };
}
