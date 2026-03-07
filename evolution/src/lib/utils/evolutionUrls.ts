// Centralized URL builders for all evolution dashboard cross-links.
// Keeps URL patterns in one place so changes propagate automatically.

/** Link to the public explanation results page. */
export function buildExplanationUrl(explanationId: number): string {
  return `/results?explanation_id=${explanationId}`;
}

/** Link to a specific evolution run's detail page. */
export function buildRunUrl(runId: string): string {
  return `/admin/evolution/runs/${runId}`;
}

/** Link to a specific variant within a run's Variants tab. */
export function buildVariantUrl(runId: string, variantId: string): string {
  return `/admin/evolution/runs/${runId}?tab=variants&variant=${variantId}`;
}

/** Link to a variant's full detail page. */
export function buildVariantDetailUrl(variantId: string): string {
  return `/admin/evolution/variants/${variantId}`;
}

/** Link to a specific agent invocation's detail page. */
export function buildInvocationUrl(invocationId: string): string {
  return `/admin/evolution/invocations/${invocationId}`;
}

/** Link to a specific experiment's detail page. */
export function buildExperimentUrl(experimentId: string): string {
  return `/admin/evolution/experiments/${experimentId}`;
}

/** Link to an arena topic's detail page. */
export function buildArenaTopicUrl(topicId: string): string {
  return `/admin/evolution/arena/${topicId}`;
}

/** Alias for buildArenaTopicUrl — prompts are arena topics. */
export const buildPromptUrl = buildArenaTopicUrl;

/** Link to a strategy's detail page. */
export function buildStrategyUrl(strategyId: string): string {
  return `/admin/evolution/strategies/${strategyId}`;
}
