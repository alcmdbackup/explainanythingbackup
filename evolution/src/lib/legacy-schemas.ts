// Legacy execution_detail schemas for historical evolution_agent_invocations rows.
//
// The new parallelized pipeline (generate_rank_evolution_parallel_20260331) replaces
// GenerationAgent + RankingAgent with three new agents (generateFromPreviousArticle,
// SwissRankingAgent, MergeRatingsAgent). Their CLASS files are deleted, but historical
// invocation rows still carry agent_name='generation' / 'ranking' with execution_detail
// matching the old schemas. The admin invocation detail view, ConfigDrivenDetailRenderer,
// and recomputeInvocationMetrics all need to validate those legacy rows — so we keep the
// schemas alive in this dedicated module.
//
// New code should NOT import these. Use the new agents' execution detail schemas instead.

import {
  generationExecutionDetailSchema,
  rankingExecutionDetailSchema,
} from './schemas';

/** Map of legacy agent_name → its execution_detail Zod schema. */
export const legacyExecutionDetailSchemas = {
  generation: generationExecutionDetailSchema,
  ranking: rankingExecutionDetailSchema,
} as const;

export type LegacyAgentName = keyof typeof legacyExecutionDetailSchemas;
