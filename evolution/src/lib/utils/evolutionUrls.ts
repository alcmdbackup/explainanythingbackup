// Centralized URL builders for all evolution dashboard cross-links.
// Keeps URL patterns in one place so changes propagate automatically.

/** Link to the public explanation results page. */
export function buildExplanationUrl(explanationId: number): string {
  return `/results?explanation_id=${explanationId}`;
}

/** Link to a specific evolution run's detail page. */
export function buildRunUrl(runId: string): string {
  return `/admin/quality/evolution/run/${runId}`;
}

/** Link to a specific variant within a run's Variants tab. */
export function buildVariantUrl(runId: string, variantId: string): string {
  return `/admin/quality/evolution/run/${runId}?tab=variants&variant=${variantId}`;
}

/** Link to an article's detail page. */
export function buildArticleUrl(explanationId: string): string {
  return `/admin/quality/evolution/article/${explanationId}`;
}

/** Link to a variant's full detail page. */
export function buildVariantDetailUrl(variantId: string): string {
  return `/admin/quality/evolution/variant/${variantId}`;
}

/** Link to a specific agent invocation's detail page. */
export function buildInvocationUrl(invocationId: string): string {
  return `/admin/quality/evolution/invocation/${invocationId}`;
}

/** Link to a specific experiment's detail page. */
export function buildExperimentUrl(experimentId: string): string {
  return `/admin/quality/optimization/experiment/${experimentId}`;
}

/** Link to an arena topic's detail page. */
export function buildArenaTopicUrl(topicId: string): string {
  return `/admin/quality/arena/${topicId}`;
}

/** Alias for buildArenaTopicUrl — prompts are arena topics. */
export const buildPromptUrl = buildArenaTopicUrl;

/** Link to a strategy's detail page. */
export function buildStrategyUrl(strategyId: string): string {
  return `/admin/quality/strategies/${strategyId}`;
}

/** Explorer filter shape for URL construction. */
export interface ExplorerUrlFilters {
  view?: string;
  unit?: string;
  prompts?: string[];
  strategies?: string[];
  pipelines?: string[];
  datePreset?: string;
  dateFrom?: string;
  dateTo?: string;
  metric?: string;
  groupBy?: string;
  trendMetric?: string;
  bucket?: string;
  matrixRow?: string;
  matrixCol?: string;
}

/** Link to the explorer page with optional filter query params. */
export function buildExplorerUrl(filters?: ExplorerUrlFilters | Record<string, string>): string {
  const base = '/admin/quality/explorer';
  if (!filters || Object.keys(filters).length === 0) return base;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else {
      params.set(key, String(value));
    }
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
