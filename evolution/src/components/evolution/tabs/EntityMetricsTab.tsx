// Generic metrics tab for any evolution entity type. Fetches from evolution_metrics table,
// groups by category, and renders using MetricGrid with CI data and aggregation badges.
'use client';

import { useEffect, useState } from 'react';
import { MetricGrid, type MetricItem } from '@evolution/components/evolution';
import { getEntityMetricsAction } from '@evolution/services/metricsActions';
import { getEntityMetricDef } from '@evolution/lib/core/entityRegistry';
import { METRIC_FORMATTERS } from '@evolution/lib/core/metricCatalog';
import type { EntityType, MetricFormatter } from '@evolution/lib/core/types';
import { DYNAMIC_METRIC_PREFIXES, type MetricRow } from '@evolution/lib/metrics/types';

interface EntityMetricsTabProps {
  entityType: EntityType;
  entityId: string;
}

type Category = 'cost' | 'rating' | 'match' | 'count';

const CATEGORY_LABELS: Record<Category, string> = {
  cost: 'Cost',
  rating: 'Rating',
  match: 'Match Stats',
  count: 'Counts',
};

const CATEGORY_ORDER: Category[] = ['rating', 'cost', 'match', 'count'];

function resolveCategory(metricName: string, entityType: EntityType): Category {
  const def = getEntityMetricDef(entityType, metricName);
  if (def) return def.category;
  if (DYNAMIC_METRIC_PREFIXES.some(p => metricName.startsWith(p))) return 'cost';
  return 'count';
}

function resolveFormatter(metricName: string, entityType: EntityType): (v: number) => string {
  const def = getEntityMetricDef(entityType, metricName);
  if (def) return METRIC_FORMATTERS[def.formatter as MetricFormatter];
  if (DYNAMIC_METRIC_PREFIXES.some(p => metricName.startsWith(p))) return METRIC_FORMATTERS.costDetailed;
  return METRIC_FORMATTERS.integer;
}

function resolveLabel(metricName: string, entityType: EntityType): string {
  const def = getEntityMetricDef(entityType, metricName);
  if (def) return def.label;
  // Dynamic metric: prettify "agentCost:generation" → "Generation Cost"
  const colonIdx = metricName.indexOf(':');
  if (colonIdx >= 0) {
    const suffix = metricName.slice(colonIdx + 1);
    return suffix.charAt(0).toUpperCase() + suffix.slice(1) + ' Cost';
  }
  return metricName;
}

function toMetricItem(row: MetricRow, entityType: EntityType): MetricItem & { category: Category; aggregation?: string } {
  const formatter = resolveFormatter(row.metric_name, entityType);
  return {
    id: row.metric_name,
    label: resolveLabel(row.metric_name, entityType),
    value: formatter(row.value),
    ci: row.ci_lower != null && row.ci_upper != null ? [row.ci_lower, row.ci_upper] : undefined,
    // U27 (use_playwright_find_bugs_ux_issues_20260422): use the same formatter
    // for CI bounds as for the center value, so an Elo-scale metric like
    // "1384 [1204.56, 1563.36]" renders as "1384 [1205, 1563]".
    ciFormatter: formatter,
    n: row.n,
    category: resolveCategory(row.metric_name, entityType),
    aggregation: row.aggregation_method ?? undefined,
  };
}

export function EntityMetricsTab({ entityType, entityId }: EntityMetricsTabProps): JSX.Element {
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const result = await getEntityMetricsAction(entityType, entityId);
      if (result.success && result.data) {
        setMetrics(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load metrics');
      }
      setLoading(false);
    }
    load();
  }, [entityType, entityId]);

  if (loading) {
    return (
      <div className="space-y-4" data-testid="metrics-loading">
        {[1, 2].map(i => (
          <div key={i} className="h-32 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-[var(--status-error)] font-ui text-sm" data-testid="metrics-error">{error}</p>;
  }

  if (metrics.length === 0) {
    return (
      <p className="text-[var(--text-secondary)] font-ui text-sm" data-testid="metrics-empty">
        No metrics recorded for this {entityType}.
      </p>
    );
  }

  // Filter out agentCost:* metrics — superseded by total_generation_cost/total_ranking_cost
  const filteredMetrics = metrics.filter(m => !m.metric_name.startsWith('agentCost:'));
  // Group by category
  const items = filteredMetrics.map(m => toMetricItem(m, entityType));
  const grouped = new Map<Category, (MetricItem & { aggregation?: string })[]>();
  for (const item of items) {
    const { category, ...rest } = item;
    const list = grouped.get(category) ?? [];
    list.push(rest);
    grouped.set(category, list);
  }

  // U26 (use_playwright_find_bugs_ux_issues_20260422): the Cost section
  // accumulated 11 metrics that mix true spend (cost / generation_cost /
  // ranking_cost / seed_cost / total_*) with estimation-accuracy noise
  // (estimation_error_pct, agent_cost_projected vs actual, dispatch counts).
  // Split into two sub-sections so users can scan spend at a glance and
  // optionally expand the accuracy diagnostics.
  function isEstimationMetric(id: string): boolean {
    return /estimation|estimated|projected|dispatched|gfsa_duration/.test(id)
      || id.startsWith('avg_agent_cost_')
      || id === 'agent_cost_projected' || id === 'agent_cost_actual';
  }

  return (
    <div className="space-y-6" data-testid="entity-metrics-tab">
      {CATEGORY_ORDER.filter(cat => grouped.has(cat)).map(cat => {
        const list = grouped.get(cat)!;
        if (cat === 'cost' && list.length > 6) {
          const spent = list.filter(m => !isEstimationMetric(m.id ?? ''));
          const accuracy = list.filter(m => isEstimationMetric(m.id ?? ''));
          return (
            <div key={cat}>
              <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">
                {CATEGORY_LABELS[cat]}
              </h3>
              {spent.length > 0 && (
                <div className="mb-3" data-testid="metrics-cost-spent">
                  <h4 className="text-sm font-ui font-medium text-[var(--text-muted)] mb-1">Spent</h4>
                  <MetricGrid
                    metrics={spent}
                    columns={Math.min(spent.length, 4) as 2 | 3 | 4}
                    variant="bordered"
                  />
                </div>
              )}
              {accuracy.length > 0 && (
                <details className="mt-2" data-testid="metrics-cost-accuracy">
                  <summary className="text-sm font-ui font-medium text-[var(--text-muted)] cursor-pointer mb-1">
                    Estimation accuracy ({accuracy.length})
                  </summary>
                  <MetricGrid
                    metrics={accuracy}
                    columns={Math.min(accuracy.length, 4) as 2 | 3 | 4}
                    variant="bordered"
                  />
                </details>
              )}
            </div>
          );
        }
        return (
          <div key={cat}>
            <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">
              {CATEGORY_LABELS[cat]}
            </h3>
            <MetricGrid
              metrics={list}
              columns={Math.min(list.length, 4) as 2 | 3 | 4}
              variant="bordered"
              testId={`metrics-${cat}`}
            />
          </div>
        );
      })}
    </div>
  );
}
