// Shared "Runs" tab for Strategy, Experiment, and Prompt detail pages.
// Fetches and displays runs related to a parent entity using EntityTable.

'use client';

import { useEffect, useState } from 'react';
import { EntityTable, type ColumnDef } from '../EntityTable';
import { EvolutionStatusBadge } from '../EvolutionStatusBadge';
import type { EvolutionRunStatus } from '@evolution/lib/types';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCost } from '@evolution/lib/utils/formatters';
import { getStrategyRunsAction, type StrategyRunEntry } from '@evolution/services/eloBudgetActions';
import { getExperimentAction } from '@evolution/services/experimentActionsV2';
import { getEvolutionRunsAction, type EvolutionRun } from '@evolution/services/evolutionActions';

export type RelatedRunsTabProps =
  | { strategyId: string; experimentId?: never; promptId?: never }
  | { experimentId: string; strategyId?: never; promptId?: never }
  | { promptId: string; strategyId?: never; experimentId?: never };

interface NormalizedRun {
  id: string;
  status: string;
  elo: number | null;
  cost: number;
  iterations: number | null;
  created: string;
  topic?: string;
}

function normalizeStrategyRun(r: StrategyRunEntry): NormalizedRun {
  return {
    id: r.runId,
    status: r.status,
    elo: r.finalElo,
    cost: r.totalCostUsd,
    iterations: r.iterations,
    created: r.startedAt ? new Date(r.startedAt).toLocaleDateString() : '—',
    topic: r.explanationTitle,
  };
}

function normalizeExperimentRun(r: Record<string, unknown>): NormalizedRun {
  return {
    id: r.id as string,
    status: r.status as string,
    elo: null,
    cost: 0,
    iterations: null,
    created: r.created_at ? new Date(r.created_at as string).toLocaleDateString() : '—',
  };
}

function normalizeEvolutionRun(r: EvolutionRun): NormalizedRun {
  return {
    id: r.id,
    status: r.status,
    elo: null,
    cost: r.total_cost_usd ?? 0,
    iterations: r.current_iteration ?? null,
    created: new Date(r.created_at).toLocaleDateString(),
  };
}

const COLUMNS: ColumnDef<NormalizedRun>[] = [
  {
    key: 'id',
    header: 'Run',
    render: (r) => <span className="font-mono">{r.id.substring(0, 8)}…</span>,
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <EvolutionStatusBadge status={r.status as EvolutionRunStatus} />,
  },
  {
    key: 'elo',
    header: 'Elo',
    align: 'right',
    sortable: true,
    render: (r) => (r.elo != null ? r.elo.toFixed(0) : '—'),
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    sortable: true,
    render: (r) => formatCost(r.cost),
  },
  {
    key: 'created',
    header: 'Created',
    align: 'right',
    render: (r) => r.created,
  },
];

const TOPIC_COLUMN: ColumnDef<NormalizedRun> = {
  key: 'topic',
  header: 'Topic',
  render: (r) => (
    <span className="max-w-[200px] truncate block text-[var(--text-secondary)]">
      {r.topic ?? '—'}
    </span>
  ),
};

export function RelatedRunsTab(props: RelatedRunsTabProps): JSX.Element {
  const [runs, setRuns] = useState<NormalizedRun[]>([]);
  const [loading, setLoading] = useState(true);

  const entityId = (props.strategyId ?? props.experimentId ?? props.promptId) as string;
  const entityType: 'strategy' | 'experiment' | 'prompt' =
    props.strategyId ? 'strategy' : props.experimentId ? 'experiment' : 'prompt';

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      if (entityType === 'strategy') {
        const res = await getStrategyRunsAction({ strategyId: entityId, limit: 50 });
        if (res.success && res.data) setRuns(res.data.map(normalizeStrategyRun));
      } else if (entityType === 'experiment') {
        const res = await getExperimentAction({ experimentId: entityId });
        if (res.success && res.data?.evolution_runs) {
          setRuns((res.data.evolution_runs as Record<string, unknown>[]).map(normalizeExperimentRun));
        }
      } else {
        const res = await getEvolutionRunsAction({ promptId: entityId });
        if (res.success && res.data) setRuns(res.data.map(normalizeEvolutionRun));
      }
      setLoading(false);
    }
    load();
  }, [entityId, entityType]);

  const showTopic = entityType === 'strategy';
  const cols = showTopic ? [COLUMNS[0], COLUMNS[1], TOPIC_COLUMN, ...COLUMNS.slice(2)] : COLUMNS;

  return (
    <EntityTable
      columns={cols}
      items={runs}
      loading={loading}
      getRowHref={(r) => buildRunUrl(r.id)}
      emptyMessage="No runs found."
      emptySuggestion="Runs will appear here once they are created."
      testId="related-runs"
    />
  );
}
