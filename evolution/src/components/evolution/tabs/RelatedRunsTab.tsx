// Experiment "Runs" tab — fetches and displays runs for an experiment using EntityTable.

'use client';

import { useEffect, useState } from 'react';
import { EntityTable, type ColumnDef } from '../tables/EntityTable';
import { StatusBadge } from '../primitives/StatusBadge';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { getExperimentAction } from '@evolution/services/experimentActions';
import { getBatchMetricsAction } from '@evolution/services/metricsActions';

export interface RelatedRunsTabProps {
  experimentId: string;
}

interface NormalizedRun {
  id: string;
  status: string;
  cost: number;
  created: string;
}

function normalizeExperimentRun(r: Record<string, unknown>): NormalizedRun {
  return {
    id: r.id as string,
    status: r.status as string,
    cost: Number(r.total_cost ?? r.cost_usd ?? 0),
    created: r.created_at ? new Date(r.created_at as string).toLocaleDateString() : '—',
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
    render: (r) => <StatusBadge variant="run-status" status={r.status} />,
  },
  {
    key: 'cost',
    header: 'Cost',
    align: 'right',
    sortable: true,
    render: (r) => r.cost > 0 ? `$${r.cost.toFixed(2)}` : '—',
  },
  {
    key: 'created',
    header: 'Created',
    align: 'right',
    render: (r) => r.created,
  },
];

export function RelatedRunsTab({ experimentId }: RelatedRunsTabProps): JSX.Element {
  const [runs, setRuns] = useState<NormalizedRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      const res = await getExperimentAction({ experimentId });
      if (res.success && res.data?.evolution_runs) {
        const rawRuns = res.data.evolution_runs as Record<string, unknown>[];
        const normalized = rawRuns.map(normalizeExperimentRun);

        // Fetch actual costs from metrics
        const runIds = normalized.map(r => r.id);
        if (runIds.length > 0) {
          const costResult = await getBatchMetricsAction('run', runIds, ['cost']);
          if (costResult.success && costResult.data) {
            for (const r of normalized) {
              const costRow = costResult.data[r.id]?.find(m => m.metric_name === 'cost');
              if (costRow) r.cost = costRow.value;
            }
          }
        }

        setRuns(normalized);
      }
      setLoading(false);
    }
    load();
  }, [experimentId]);

  return (
    <EntityTable
      columns={COLUMNS}
      items={runs}
      loading={loading}
      getRowHref={(r) => buildRunUrl(r.id)}
      emptyMessage="No runs found."
      emptySuggestion="Runs will appear here once they are created."
      testId="related-runs"
    />
  );
}
