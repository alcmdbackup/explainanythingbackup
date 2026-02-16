// Feature flags for evolution pipeline. Experimental toggles read from env vars; core agents always-on.

/** Per-agent feature flags for the evolution pipeline. */
export interface EvolutionFeatureFlags {
  /** Tournament agent — always on (hardcoded). */
  tournamentEnabled: boolean;
  /** EvolutionAgent (evolvePool) — always on (hardcoded). */
  evolvePoolEnabled: boolean;
  /** DebateAgent — always on (hardcoded). */
  debateEnabled: boolean;
  /** IterativeEditingAgent — on unless treeSearch is on (mutex). */
  iterativeEditingEnabled: boolean;
  /** SectionDecompositionAgent — always on (hardcoded). */
  sectionDecompositionEnabled: boolean;
  /** OutlineGenerationAgent — experimental, env var opt-in. */
  outlineGenerationEnabled: boolean;
  /** TreeSearchAgent — experimental, env var opt-in (mutually exclusive with iterativeEditing). */
  treeSearchEnabled: boolean;
  /** Flow critique second pass — experimental, env var opt-in. */
  flowCritiqueEnabled: boolean;
}

/** Safe defaults: core agents always-on, experimental agents off. */
export const DEFAULT_EVOLUTION_FLAGS: EvolutionFeatureFlags = {
  tournamentEnabled: true,
  evolvePoolEnabled: true,
  debateEnabled: true,
  iterativeEditingEnabled: true,
  sectionDecompositionEnabled: true,
  outlineGenerationEnabled: false,
  treeSearchEnabled: false,
  flowCritiqueEnabled: false,
};

/**
 * Read evolution feature flags from environment variables (sync, no DB).
 * 3 experimental toggles from EVOLUTION_* env vars; 5 core agent flags hardcoded as always-on.
 */
export function getFeatureFlags(): EvolutionFeatureFlags {
  const treeSearch = process.env.EVOLUTION_TREE_SEARCH === 'true';
  return {
    tournamentEnabled: true,
    evolvePoolEnabled: true,
    debateEnabled: true,
    iterativeEditingEnabled: !treeSearch,
    sectionDecompositionEnabled: true,
    outlineGenerationEnabled: process.env.EVOLUTION_OUTLINE_GENERATION === 'true',
    treeSearchEnabled: treeSearch,
    flowCritiqueEnabled: process.env.EVOLUTION_FLOW_CRITIQUE === 'true',
  };
}
