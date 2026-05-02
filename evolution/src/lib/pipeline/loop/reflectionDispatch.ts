// Pure dispatch-resolution helpers for the reflection wrapper agent. Keeps the
// orchestrator's per-iteration kill-switch logic isolated and unit-testable
// without spinning up evolveArticle's full mock graph.

import type { EvolutionConfig } from '../infra/types';

type IterationConfig = EvolutionConfig['iterationConfigs'][number];

/**
 * Resolve whether the wrapper agent (ReflectAndGenerateFromPreviousArticleAgent)
 * should dispatch for this iteration. Two conditions must BOTH hold:
 *
 *   1. The iteration's agentType is `reflect_and_generate` (config-level opt-in).
 *   2. The `EVOLUTION_REFLECTION_ENABLED` env var is NOT the literal string `'false'`
 *      (operations-level kill-switch — single env flip rolls reflection back to
 *      vanilla GFPA dispatch without code revert).
 *
 * Any other agentType (`generate`, `swiss`) returns false regardless of env.
 *
 * Shape A of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430.
 */
export function resolveReflectionEnabled(
  iterCfg: Pick<IterationConfig, 'agentType'>,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return iterCfg.agentType === 'reflect_and_generate'
    && env.EVOLUTION_REFLECTION_ENABLED !== 'false';
}
