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

/** Link to a run's comparison view. */
export function buildRunCompareUrl(runId: string): string {
  return `/admin/evolution/runs/${runId}/compare`;
}

/** Link to a run's logs tab (optionally filtered). */
export function buildRunLogsUrl(runId: string, options?: { level?: string; agent?: string }): string {
  const params = new URLSearchParams({ tab: 'logs' });
  if (options?.level) params.set('level', options.level);
  if (options?.agent) params.set('agent', options.agent);
  return `/admin/evolution/runs/${runId}?${params.toString()}`;
}

/** Link to a specific arena entry within a topic's leaderboard. */
export function buildArenaEntryUrl(entryId: string): string {
  return `/admin/evolution/arena?entry=${entryId}`;
}
