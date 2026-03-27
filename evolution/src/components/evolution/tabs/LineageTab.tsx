'use client';
// Lineage tab showing the variant DAG for an evolution run.
// V2 rewrite: uses getEvolutionRunLineageAction for simple node list (no tree search).

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  getEvolutionRunLineageAction,
  type LineageNode,
} from '@evolution/services/evolutionVisualizationActions';

const LineageGraph = dynamic(
  () => import('@evolution/components/evolution/visualizations/LineageGraph').then(m => m.LineageGraph),
  {
    ssr: false,
    loading: () => (
      <div className="h-[500px] bg-[var(--surface-secondary)] rounded-book animate-pulse" />
    ),
  },
);

interface LineageTabProps {
  runId: string;
}

export function LineageTab({ runId }: LineageTabProps): JSX.Element {
  const [nodes, setNodes] = useState<LineageNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunLineageAction(runId);
      if (result.success && result.data) {
        setNodes(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load lineage data');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) return <div className="h-[500px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  if (nodes.length === 0) {
    return <div className="text-[var(--text-muted)] text-sm p-4" data-testid="lineage-tab-empty">No lineage data available</div>;
  }

  // Convert LineageNode[] to LineageData format expected by LineageGraph
  const graphNodes = nodes.map(n => ({
    id: n.id,
    shortId: n.id.substring(0, 8),
    strategy: n.agentName,
    elo: n.eloScore,
    iterationBorn: n.generation,
    isWinner: n.isWinner,
  }));

  const graphEdges = nodes
    .filter(n => n.parentId)
    .map(n => ({ source: n.parentId!, target: n.id }));

  return (
    <div data-testid="lineage-tab">
      <LineageGraph nodes={graphNodes} edges={graphEdges} />
    </div>
  );
}
