// Invocations list page. Filterable table of agent invocations with click-through to detail.
'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { EvolutionBreadcrumb, TableSkeleton, EmptyState } from '@evolution/components/evolution';
import {
  listInvocationsAction,
  type InvocationListEntry,
} from '@evolution/services/evolutionVisualizationActions';
import { buildInvocationUrl, buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCostDetailed } from '@evolution/lib/utils/formatters';

function getInvocationStatusBadge(skipped: boolean, success: boolean): JSX.Element {
  if (skipped) {
    return <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--text-muted)]/10 text-[var(--text-muted)]">skipped</span>;
  }
  if (success) {
    return <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--status-success)]/10 text-[var(--status-success)]">success</span>;
  }
  return <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--status-error)]/10 text-[var(--status-error)]">failed</span>;
}

export default function InvocationsListPage(): JSX.Element {
  const [invocations, setInvocations] = useState<InvocationListEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [runIdFilter, setRunIdFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState<'' | 'true' | 'false'>('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listInvocationsAction({
        runId: runIdFilter || undefined,
        agentName: agentFilter || undefined,
        success: successFilter === '' ? undefined : successFilter === 'true',
        limit: 50,
      });
      if (result.success && result.data) {
        setInvocations(result.data.items);
        setTotal(result.data.total);
      } else {
        toast.error(result.error?.message || 'Failed to load invocations');
      }
    } catch {
      toast.error('Failed to load invocations');
    }
    setLoading(false);
  }, [runIdFilter, agentFilter, successFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const selectClass = 'px-3 py-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] text-[var(--text-primary)] text-sm font-ui';

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[
        { label: 'Dashboard', href: '/admin/evolution-dashboard' },
        { label: 'Invocations' },
      ]} />

      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">
            Invocations
          </h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Agent invocations across all pipeline runs ({total} total)
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
            data-testid="invocation-run-filter"
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
            data-testid="invocation-agent-filter"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-ui text-[var(--text-muted)]">Status</span>
          <select
            value={successFilter}
            onChange={(e) => setSuccessFilter(e.target.value as '' | 'true' | 'false')}
            className={selectClass}
            data-testid="invocation-success-filter"
          >
            <option value="">All</option>
            <option value="true">Success</option>
            <option value="false">Failed</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto border border-[var(--border-default)] rounded-book shadow-warm-lg" data-testid="invocations-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Agent</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Run</th>
              <th className="p-3 text-right font-ui text-[var(--text-muted)]">Iter</th>
              <th className="p-3 text-center font-ui text-[var(--text-muted)]">Status</th>
              <th className="p-3 text-right font-ui text-[var(--text-muted)]">Cost</th>
              <th className="p-3 text-left font-ui text-[var(--text-muted)]">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-0"><TableSkeleton columns={6} rows={8} /></td></tr>
            ) : invocations.length === 0 ? (
              <tr><td colSpan={6}><EmptyState message="No invocations found" /></td></tr>
            ) : (
              invocations.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)]"
                >
                  <td className="p-3">
                    <Link
                      href={buildInvocationUrl(inv.id)}
                      className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
                    >
                      {inv.agent_name}
                    </Link>
                  </td>
                  <td className="p-3">
                    <Link
                      href={buildRunUrl(inv.run_id)}
                      className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
                    >
                      {inv.run_id.substring(0, 8)}
                    </Link>
                  </td>
                  <td className="p-3 text-right text-[var(--text-muted)]">{inv.iteration}</td>
                  <td className="p-3 text-center">
                    {getInvocationStatusBadge(inv.skipped, inv.success)}
                  </td>
                  <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                    {formatCostDetailed(inv.cost_usd)}
                  </td>
                  <td className="p-3 text-[var(--text-muted)] text-xs">
                    {new Date(inv.created_at).toLocaleDateString()}{' '}
                    <span className="opacity-70">
                      {new Date(inv.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
