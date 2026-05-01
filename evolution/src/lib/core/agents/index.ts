// Eager-import barrel for all agent classes.
//
// Phase 8 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430.
//
// Importing this module pulls in every concrete agent file, which (via side-effect
// imports at the bottom of each agent file) populates the metrics-layer
// ATTRIBUTION_EXTRACTORS registry. Without an explicit barrel like this, code paths
// that import experimentMetrics.ts in isolation (e.g., worker contexts, cron jobs,
// metric-aggregation entry points that don't transitively import agentRegistry)
// would see an empty registry — leading to the legacy fallback firing for every
// invocation and silent attribution regressions.
//
// experimentMetrics.ts imports this barrel as a side-effect to guarantee
// registration ordering: by the time computeEloAttributionMetrics runs, every
// known agent has registered its extractor.
//
// Re-exports the agent classes for convenience but the load-bearing purpose is
// the side-effect of the static imports themselves.

export { GenerateFromPreviousArticleAgent } from './generateFromPreviousArticle';
export { ReflectAndGenerateFromPreviousArticleAgent } from './reflectAndGenerateFromPreviousArticle';
export { SwissRankingAgent } from './SwissRankingAgent';
export { MergeRatingsAgent } from './MergeRatingsAgent';
export { CreateSeedArticleAgent } from './createSeedArticle';
