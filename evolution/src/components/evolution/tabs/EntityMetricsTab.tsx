'use client';
// Generic metrics tab for any evolution entity type. Fetches from evolution_metrics table,
// groups by category, and renders using MetricGrid with CI data and aggregation badges.

import { useEffect, useState } from 'react';
import { MetricGrid, type MetricItem } from '@evolution/components/evolution';
import { getEntityMetricsAction } from '@evolution/services/metricsActions';
import { getEntityMetricDef } from '@evolution/lib/core/entityRegistry';
import { METRIC_FORMATTERS } from '@evolution/lib/core/metricCatalog';
import type { MetricFormatter } from '@evolution/lib/core/types';
import { DYNAMIC_METRIC_PREFIXES, type EntityType, type MetricRow } from '@evolution/lib/metrics/types';
import type { EntityType as CoreEntityType } from '@evolution/lib/core/types';

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
  const def = getEntityMetricDef(entityType as CoreEntityType, metricName);
  if (def) return def.category;
  if (DYNAMIC_METRIC_PREFIXES.some(p => metricName.startsWith(p))) return 'cost';
  return 'count';
}

function resolveFormatter(metricName: string, entityType: EntityType): (v: number) => string {
  const def = getEntityMetricDef(entityType as CoreEntityType, metricName);
  if (def) return METRIC_FORMATTERS[def.formatter as MetricFormatter];
  if (DYNAMIC_METRIC_PREFIXES.some(p => metricName.startsWith(p))) return METRIC_FORMATTERS.costDetailed;
  return METRIC_FORMATTERS.integer;
}

function resolveLabel(metricName: string, entityType: EntityType): string {
  const def = getEntityMetricDef(entityType as CoreEntityType, metricName);
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
    label: resolveLabel(row.metric_name, entityType),
    value: formatter(row.value),
    ci: row.ci_lower != null && row.ci_upper != null ? [row.ci_lower, row.ci_upper] : undefined,
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
    return <p className="text-[var(--status-error)] font-ui text-sm">{error}</p>;
  }

  if (metrics.length === 0) {
    return (
      <p className="text-[var(--text-secondary)] font-ui text-sm" data-testid="metrics-empty">
        No metrics recorded for this {entityType}.
      </p>
    );
  }

  // Group by category
  const items = metrics.map(m => toMetricItem(m, entityType));
  const grouped = new Map<Category, (MetricItem & { aggregation?: string })[]>();
  for (const item of items) {
    const { category, ...rest } = item;
    const list = grouped.get(category) ?? [];
    list.push(rest);
    grouped.set(category, list);
  }

  return (
    <div className="space-y-6" data-testid="entity-metrics-tab">
      {CATEGORY_ORDER.filter(cat => grouped.has(cat)).map(cat => (
        <div key={cat}>
          <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">
            {CATEGORY_LABELS[cat]}
          </h3>
          <MetricGrid
            metrics={grouped.get(cat)!}
            columns={Math.min(grouped.get(cat)!.length, 4) as 2 | 3 | 4}
            variant="bordered"
            testId={`metrics-${cat}`}
          />
        </div>
      ))}
    </div>
  );
}
