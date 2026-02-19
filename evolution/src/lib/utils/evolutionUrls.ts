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
