// Generic metrics tab for any evolution entity type. Fetches from evolution_metrics table,
// groups by category, and renders using MetricGrid with CI data and aggregation badges.
'use client';

import { useEffect, useState } from 'react';
import { MetricGrid, type MetricItem } from '@evolution/components/evolution';
import { getEntityMetricsAction } from '@evolution/services/metricsActions';
import { getEntityMetricDef } from '@evolution/lib/core/entityRegistry';
import { METRIC_FORMATTERS } from '@evolution/lib/core/metricCatalog';
import type { EntityType, MetricFormatter } from '@evolution/lib/core/types';
import { DYNAMIC_METRIC_REGISTRY, type MetricRow } from '@evolution/lib/metrics/types';
import { abortableEffectController } from '@evolution/lib/utils/abortableEffect';

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

/** Look up the dynamic-metric registry entry whose prefix matches `name`. */
function dynamicMatch(name: string): { prefix: string; cfg: typeof DYNAMIC_METRIC_REGISTRY[keyof typeof DYNAMIC_METRIC_REGISTRY] } | null {
  for (const [prefix, cfg] of Object.entries(DYNAMIC_METRIC_REGISTRY)) {
    if (name.startsWith(prefix)) return { prefix, cfg };
  }
  return null;
}

function resolveCategory(metricName: string, entityType: EntityType): Category {
  const def = getEntityMetricDef(entityType, metricName);
  if (def) return def.category;
  const dyn = dynamicMatch(metricName);
  return dyn ? (dyn.cfg.category as Category) : 'count';
}

function resolveFormatter(metricName: string, entityType: EntityType): (v: number) => string {
  const def = getEntityMetricDef(entityType, metricName);
  if (def) return METRIC_FORMATTERS[def.formatter as MetricFormatter];
  const dyn = dynamicMatch(metricName);
  return dyn ? METRIC_FORMATTERS[dyn.cfg.formatter as MetricFormatter] : METRIC_FORMATTERS.integer;
}

function resolveLabel(metricName: string, entityType: EntityType): string {
  const def = getEntityMetricDef(entityType, metricName);
  if (def) return def.label;
  const dyn = dynamicMatch(metricName);
  if (!dyn) return metricName;
  // Prettify the suffix after the prefix: split on `:`, capitalize each segment,
  // join with ` / `, then append the registry-defined labelSuffix (e.g. " Δ Elo").
  const suffix = metricName.slice(dyn.prefix.length);
  const pretty = suffix
    .split(':')
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' / ');
  return pretty + dyn.cfg.labelSuffix;
}

// U23 (use_playwright_find_bugs_ux_issues_20260422): explain what each per-purpose
// cost actually rolls up. H4 (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):
// the old `cost` description said "= generation + ranking + seed" — that was true 6+ phases
// ago but is factually wrong post Phase-6 (reflection, iterative-edit, evaluation,
// proposer/approver, paragraph_recombine, debate all also contribute). H3: added entries
// for the missing per-purpose metrics (paragraph_recombine_cost, evaluation_cost,
// iterative_edit_cost, proposer_approver_criteria_cost, reflection_cost, debate_cost).
const COST_DESCRIPTIONS: Record<string, string> = {
  cost: 'Total run cost = sum of all per-purpose LLM cost layers (generation, ranking, reflection, seed, evaluation, iterative_edit, proposer_approver_criteria, paragraph_recombine, debate). Includes all LLM calls.',
  generation_cost: 'Cost of LLM calls during the generation phase. Included in Spent.',
  ranking_cost: 'Cost of LLM calls during the ranking phase (judge model). Included in Spent.',
  reflection_cost: 'Cost of LLM calls for the reflect-and-generate wrapper (one reflection call per parent before delegating to GFPA). Included in Spent.',
  seed_cost: 'Cost of LLM calls to seed the initial pool. Included in Spent.',
  evaluation_cost: 'Cost of LLM calls for the criteria-driven `evaluate_and_suggest` combined call (scores criteria + drafts fix suggestions in one prompt). Included in Spent.',
  iterative_edit_cost: 'Cost of LLM calls for the iterative-editing agent (Proposer + Approver + drift-recovery per cycle). Included in Spent.',
  proposer_approver_criteria_cost: 'Cost of LLM calls for the proposer/approver criteria agent (umbrella: propose + forward-approve + mirror-approve). Included in Spent.',
  paragraph_recombine_cost: 'Cost of LLM calls for the paragraph_recombine agent (per-paragraph rewrite + per-slot ranking). Included in Spent. Article-level ranking of the recombined variant flows to ranking_cost, not here.',
  debate_cost: 'Cost of LLM calls for the debate-and-generate agent (combined judge + synthesis). Included in Spent.',
  total_cost: 'Sum of cost across all aggregated runs.',
  total_generation_cost: 'Sum of generation_cost across all aggregated runs. Included in Total Cost.',
  total_ranking_cost: 'Sum of ranking_cost across all aggregated runs. Included in Total Cost.',
  total_seed_cost: 'Sum of seed_cost across all aggregated runs. Included in Total Cost.',
  total_paragraph_recombine_cost: 'Sum of paragraph_recombine_cost across all aggregated runs. Included in Total Cost.',
  total_debate_cost: 'Sum of debate_cost across all aggregated runs. Included in Total Cost.',
  total_evaluation_cost: 'Sum of evaluation_cost across all aggregated runs. Included in Total Cost.',
  total_iterative_edit_cost: 'Sum of iterative_edit_cost across all aggregated runs. Included in Total Cost.',
  total_proposer_approver_criteria_cost: 'Sum of proposer_approver_criteria_cost across all aggregated runs. Included in Total Cost.',
  total_reflection_cost: 'Sum of reflection_cost across all aggregated runs. Included in Total Cost.',
  avg_cost_per_run: 'Average cost across runs.',
  avg_generation_cost_per_run: 'Average generation_cost across runs. Included in Avg Cost/Run.',
  avg_ranking_cost_per_run: 'Average ranking_cost across runs. Included in Avg Cost/Run.',
  avg_seed_cost_per_run: 'Average seed_cost across runs. Included in Avg Cost/Run.',
  avg_paragraph_recombine_cost_per_run: 'Average paragraph_recombine_cost across runs. Included in Avg Cost/Run.',
};

// U26 (use_playwright_find_bugs_ux_issues_20260422): classifies a Cost-category
// metric id as estimation-accuracy diagnostics (vs. true spend), so the Cost
// section can split into "Spent" (above-the-fold) and a collapsible
// "Estimation accuracy" details block.
function isEstimationMetric(id: string): boolean {
  return /estimation|estimated|projected|dispatched|gfsa_duration/.test(id)
    || id.startsWith('avg_agent_cost_')
    || id === 'agent_cost_projected' || id === 'agent_cost_actual';
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
    description: COST_DESCRIPTIONS[row.metric_name],
  };
}

export function EntityMetricsTab({ entityType, entityId }: EntityMetricsTabProps): JSX.Element {
  const [metrics, setMetrics] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // State-guard for unmount safety. Server Actions are POST RPCs whose
    // server-side work cannot be cancelled from the client, but we can prevent
    // setState writes after unmount. Without this guard, Firefox surfaces
    // racing fetches as NS_BINDING_ABORTED during chained nav.
    // TODO(perf): plumb AbortSignal through getEntityMetricsAction if response
    // cancellation becomes important — separate PR.
    const ctl = abortableEffectController();
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      const result = await getEntityMetricsAction(entityType, entityId);
      if (ctl.cancelled) return;
      if (result.success && result.data) {
        setMetrics(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load metrics');
      }
      setLoading(false);
    }
    load();
    return () => ctl.abort();
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

  // (rename_agents_subagents_evolution_20260508 Phase 6) The legacy
  // `agentCost:*` filter was removed alongside the prefix itself. Per-subagent
  // costs now live under `subagent:*.cost` and are displayed alongside static
  // `*_cost` metrics — duplication risk acceptable; rows distinguish by name.
  // Group by category
  type GroupedMetric = MetricItem & { aggregation?: string };
  const items = metrics.map(m => toMetricItem(m, entityType));
  const grouped = new Map<Category, GroupedMetric[]>();
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
  // When the Cost group has >6 metrics, split into two sub-sections so users
  // can scan spend at a glance and optionally expand the accuracy diagnostics.
  const gridFor = (m: GroupedMetric[], testId?: string): JSX.Element => (
    <MetricGrid
      metrics={m}
      columns={Math.min(m.length, 4) as 2 | 3 | 4}
      variant="bordered"
      testId={testId}
    />
  );

  return (
    <div className="space-y-6" data-testid="entity-metrics-tab">
      {CATEGORY_ORDER.filter(cat => grouped.has(cat)).map(cat => {
        const list = grouped.get(cat)!;
        const heading = (
          <h3 className="text-xl font-display font-medium text-[var(--text-secondary)] mb-2">
            {CATEGORY_LABELS[cat]}
          </h3>
        );
        if (cat !== 'cost' || list.length <= 6) {
          return <div key={cat}>{heading}{gridFor(list, `metrics-${cat}`)}</div>;
        }
        const spent: GroupedMetric[] = [];
        const accuracy: GroupedMetric[] = [];
        for (const m of list) {
          (isEstimationMetric(m.id ?? '') ? accuracy : spent).push(m);
        }
        return (
          <div key={cat}>
            {heading}
            {spent.length > 0 && (
              <div className="mb-3" data-testid="metrics-cost-spent">
                <h4 className="text-sm font-ui font-medium text-[var(--text-muted)] mb-1">Spent</h4>
                {gridFor(spent)}
              </div>
            )}
            {accuracy.length > 0 && (
              <details className="mt-2" data-testid="metrics-cost-accuracy">
                <summary className="text-sm font-ui font-medium text-[var(--text-muted)] cursor-pointer mb-1">
                  Estimation accuracy ({accuracy.length})
                </summary>
                {gridFor(accuracy)}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
