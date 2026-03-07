// Variants list page. Filterable table of evolution variants with click-through to detail.
'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { EvolutionBreadcrumb, TableSkeleton, EmptyState } from '@evolution/components/evolution';
import {
  listVariantsAction,
  type VariantListEntry,
} from '@evolution/services/evolutionActions';
import { buildVariantDetailUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';

export default function VariantsListPage(): JSX.Element {
  const [variants, setVariants] = useState<VariantListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [runIdFilter, setRunIdFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [winnerFilter, setWinnerFilter] = useState<'' | 'true' | 'false'>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listVariantsAction({
        runId: runIdFilter || undefined,
        agentName: agentFilter || undefined,
        isWinner: winnerFilter === '' ? undefined : winnerFilter === 'true',
        limit: 50,
      });
      if (result.success && result.data) {
        setVariants(result.data.items);
        setTotal(result.data.total);
      } else {
        toast.error(result.error?.message || 'Failed to load variants');
      }
    } catch {
      toast.error('Failed to load variants');
    }
    setLoading(false);
  }, [runIdFilter, agentFilter, winnerFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectClass = 'px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-sm font-ui';

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Variants' },
      ]} />

      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Variants
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            All evolution variants across pipeline runs ({total} total)
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 font-ui text-sm border border-[var(--border-default)] rounded-page text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] disabled:opacity-50 transition-scholar"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-ui text-[var(--text-muted)]">Run ID</span>
          <input
            type="text"
            value={runIdFilter}
            onChange={(e) => setRunIdFilter(e.target.value)}
            placeholder="Filter by run ID..."
            className={selectClass + ' w-72'}
            data-testid="variant-run-filter"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-ui text-[var(--text-muted)]">Agent</span>
          <input
            type="text"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            placeholder="Filter by agent..."
            className={selectClass + ' w-48'}
            data-testid="variant-agent-filter"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-ui text-[var(--text-muted)]">Winner</span>
          <select
            value={winnerFilter}
            onChange={(e) => setWinnerFilter(e.target.value as '' | 'true' | 'false')}
            className={selectClass}
            data-testid="variant-winner-filter"
          >
            <option value="">All</option>
            <option value="true">Winners</option>
            <option value="false">Non-winners</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book shadow-warm-lg" data-testid="variants-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">ID</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Run</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Agent</th>
              <th className="p-3 text-right font-ui text-[var(--text-muted)]">Rating</th>
              <th className="p-3 text-right font-ui text-[var(--text-muted)]">Matches</th>
              <th className="p-3 text-right font-ui text-[var(--text-muted)]">Gen</th>
              <th className="p-3 text-center font-ui text-[var(--text-muted)]">Winner</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-0"><TableSkeleton columns={8} rows={8} /></td></tr>
            ) : variants.length === 0 ? (
              <tr><td colSpan={8}><EmptyState message="No variants found" /></td></tr>
            ) : (
              variants.map((v) => (
                <tr
                  key={v.id}
                  className={`border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)] ${v.is_winner ? 'bg-[var(--status-success)]/5' : ''}`}
                >
                  <td className="p-3">
                    <Link
                      href={buildVariantDetailUrl(v.id)}
                      className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
                    >
                      {v.id.substring(0, 8)}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Link
                      href={buildRunUrl(v.run_id)}
                      className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
                    >
                      {v.run_id.substring(0, 8)}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs text-[var(--text-primary)]">{v.agent_name}</td>
                  <td className="p-3 text-right font-semibold text-[var(--text-primary)]">{Math.round(v.elo_score)}</td>
                  <td className="p-3 text-right text-[var(--text-muted)]">{v.match_count}</td>
                  <td className="p-3 text-right text-[var(--text-muted)]">{v.generation}</td>
                  <td className="p-3 text-center">
                    {v.is_winner && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--status-success)]/10 text-[var(--status-success)]">winner</span>
                    )}
                  </td>
                  <td className="p-3 text-[var(--text-muted)] text-xs">
                    {new Date(v.created_at).toLocaleDateString()}{' '}
                    <span className="opacity-70">
                      {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
