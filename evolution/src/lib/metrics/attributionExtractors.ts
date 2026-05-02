// Registry mapping agent_name → dimension-extractor function for ELO attribution.
//
// Phase 8 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430.
//
// Used by `computeEloAttributionMetrics` (in experimentMetrics.ts) to extract the
// per-(agent, dimension) attribution dimension from an invocation's execution_detail.
// Replaces the prior hardcoded `execution_detail.strategy` read with a registry-driven
// dispatch that respects each agent's `getAttributionDimension(detail)` override.
//
// Registration is via SIDE-EFFECT IMPORTS at the bottom of agent files — this avoids
// a circular dependency between the metrics layer and the agent registry. The
// metrics file imports this module statically; agent files call
// `registerAttributionExtractor(name, extractor)` at module-load time.
//
// Key invariant: the dispatch in `computeEloAttributionMetrics` is mutually exclusive
// with the legacy fallback. If a registered extractor returns a non-null dimension,
// it's used; otherwise the legacy `execution_detail.strategy` path applies. Never both.

export type DimensionExtractor = (detail: unknown) => string | null;

/**
 * Map keyed by `evolution_agent_invocations.agent_name`. Populated at module-load time
 * via `registerAttributionExtractor()` calls at the bottom of each agent file.
 *
 * Module-load ordering matters: any code path that imports `experimentMetrics.ts`
 * MUST also import the agent files (typically transitively via the agentRegistry
 * or the eager-import barrel `evolution/src/lib/core/agents/index.ts`). Without
 * those imports, the registry stays empty and the legacy fallback fires for every
 * invocation — which silently regresses attribution emission.
 */
export const ATTRIBUTION_EXTRACTORS: Record<string, DimensionExtractor> = {};

/**
 * Register a dimension extractor for a given agent_name. Idempotent: re-registering
 * with the same name overwrites the prior extractor (intentional — supports test
 * setup/teardown). For production use, each agent file should call this exactly
 * once at module-load time.
 */
export function registerAttributionExtractor(
  agentName: string,
  extractor: DimensionExtractor,
): void {
  ATTRIBUTION_EXTRACTORS[agentName] = extractor;
}

/**
 * Reset the registry — testing only. Production code should never call this.
 */
export function _resetAttributionExtractorsForTesting(): void {
  for (const key of Object.keys(ATTRIBUTION_EXTRACTORS)) {
    delete ATTRIBUTION_EXTRACTORS[key];
  }
}
