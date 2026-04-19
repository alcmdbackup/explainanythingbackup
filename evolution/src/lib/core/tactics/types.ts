// Shared type for tactic definitions — the text transformation techniques applied per variant.
// "Tactic" = the specific LLM prompt transformation. "Strategy" = the evolution_strategies entity.

export interface TacticDef {
  /** Human-readable display label. */
  label: string;
  /** Category for grouping: 'core', 'depth', 'audience', 'structural', 'quality', 'meta', 'extended'. */
  category: string;
  /** LLM role/context preamble (1 sentence). */
  preamble: string;
  /** Detailed transformation instructions for the LLM. */
  instructions: string;
}
