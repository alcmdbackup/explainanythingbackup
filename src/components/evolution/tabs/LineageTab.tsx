'use client';
// Lineage DAG tab wrapping the D3-based LineageGraph component.
// Loads lineage data and passes it to the dynamically imported graph.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  getEvolutionRunLineageAction,
  type LineageData,
} from '@/lib/services/evolutionVisualizationActions';

const LineageGraph = dynamic(
  () => import('@/components/evolution/LineageGraph').then(m => m.LineageGraph),
  {
    ssr: false,
    loading: () => (
      <div className="h-[500px] bg-[var(--surface-secondary)] rounded-book animate-pulse" />
    ),
  },
);

export function LineageTab({ runId }: { runId: string }) {
  const [data, setData] = useState<LineageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunLineageAction(runId);
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load lineage data');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) return <div className="h-[500px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  if (!data || data.nodes.length === 0) {
    return <div className="text-[var(--text-muted)] text-sm p-4">No lineage data available</div>;
  }

  return (
    <div data-testid="lineage-tab">
      <LineageGraph nodes={data.nodes} edges={data.edges} />
    </div>
  );
}
