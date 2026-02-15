'use client';
// Before/after comparison page for an evolution run.
// Shows word-level text diff and stats summary.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { diffWordsWithSpace } from 'diff';
import { EvolutionBreadcrumb } from '@/components/evolution';
import {
  getEvolutionRunComparisonAction,
  type ComparisonData,
} from '@/lib/services/evolutionVisualizationActions';

function TextDiff({ original, modified }: { original: string; modified: string }) {
  const parts = diffWordsWithSpace(original, modified);

  return (
    <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono p-4 bg-[var(--surface-secondary)] rounded-book max-h-[500px] overflow-y-auto">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <span
              key={i}
              className="bg-[var(--status-success)]/20 text-[var(--status-success)]"
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              className="bg-[var(--status-error)]/20 text-[var(--status-error)] line-through"
            >
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </pre>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4">
      <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</div>
      <div className="text-xl font-semibold text-[var(--text-primary)] mt-1">{value}</div>
    </div>
  );
}

export default function EvolutionComparePage() {
  const params = useParams();
  const runId = params.runId as string;
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getEvolutionRunComparisonAction(runId);
      if (result.success && result.data) {
        setData(result.data);
      } else {
        setError(result.error?.message ?? 'Failed to load comparison data');
      }
      setLoading(false);
    }
    load();
  }, [runId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-[var(--surface-elevated)] rounded animate-pulse" />
        <div className="h-[300px] bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      </div>
    );
  }

  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;
  if (!data) return <div className="text-[var(--text-muted)] text-sm p-4">No comparison data</div>;

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Pipeline Runs', href: '/admin/quality/evolution' },
        { label: `Run ${runId.substring(0, 8)}`, href: `/admin/quality/evolution/run/${runId}` },
        { label: 'Compare' },
      ]} />

      <h1 className="text-3xl font-display font-bold text-[var(--text-primary)]">
        Before &amp; After Comparison
      </h1>

      {/* Text diff */}
      <div data-testid="diff-section">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Text Changes</h3>
        {data.winnerText ? (
          <TextDiff original={data.originalText} modified={data.winnerText} />
        ) : (
          <div className="p-4 bg-[var(--surface-secondary)] rounded-book text-sm text-[var(--text-muted)]">
            No winner selected for this run
          </div>
        )}
      </div>

      {/* Stats summary */}
      <div data-testid="stats-section">
        <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3">Stats Summary</h3>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Elo Delta" value={data.eloImprovement !== null ? `+${data.eloImprovement.toFixed(0)}` : 'N/A'} />
          <StatCard label="Total Iterations" value={String(data.totalIterations)} />
          <StatCard label="Total Cost" value={`$${data.totalCost.toFixed(2)}`} />
          <StatCard label="Variants Explored" value={String(data.variantsExplored)} />
          <StatCard label="Winning Strategy" value={data.winnerStrategy ?? 'N/A'} />
          <StatCard label="Generation Depth" value={String(data.generationDepth)} />
        </div>
      </div>
    </div>
  );
}
