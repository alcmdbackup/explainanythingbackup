// Client component for tactic detail — tabs for overview, metrics, variants, runs, by-prompt.

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { EntityDetailHeader, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import { EntityMetricsTab } from '@evolution/components/evolution/tabs/EntityMetricsTab';
import { TacticPromptPerformanceTable } from '@evolution/components/evolution/tabs/TacticPromptPerformanceTable';
import { getTacticVariantsAction, getTacticRunsAction } from '@evolution/services/tacticActions';
import type { TacticDetailRow } from '@evolution/services/tacticActions';
import type { TabDef } from '@evolution/lib/core/types';
import { dbToRating } from '@evolution/lib/shared/computeRatings';
import { formatEloWithUncertainty } from '@evolution/lib/utils/formatters';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'variants', label: 'Variants' },
  { id: 'runs', label: 'Runs' },
  { id: 'by-prompt', label: 'By Prompt' },
];

// ─── Variants Tab ─────────────────────────────────────────────

function TacticVariantsTab({ tacticName }: { tacticName: string }) {
  const [items, setItems] = useState<Array<{ id: string; run_id: string; elo_score: number; mu: number; sigma: number; is_winner: boolean; created_at: string }>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getTacticVariantsAction({ tacticName, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    if (result.success && result.data) {
      setItems(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [tacticName, page]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-sm text-[var(--text-muted)] p-4">Loading variants...</div>;
  if (items.length === 0) return <div className="text-sm text-[var(--text-muted)] p-4">No variants found for this tactic.</div>;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="text-xs text-[var(--text-muted)]">{total} variants</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-[var(--border-default)]">
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">ID</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">Run</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)] text-right">Elo</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">Winner</th>
            <th className="py-1.5 font-ui text-[var(--text-muted)]">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map(v => {
            const rating = dbToRating(v.mu, v.sigma);
            return (
              <tr key={v.id} className="border-b border-[var(--border-subtle)] last:border-0">
                <td className="py-1.5 pr-3 font-mono">
                  <Link href={`/admin/evolution/variants/${v.id}`} className="text-[var(--accent-gold)] hover:underline">
                    {v.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 font-mono">
                  <Link href={`/admin/evolution/runs/${v.run_id}`} className="text-[var(--accent-gold)] hover:underline">
                    {v.run_id.slice(0, 8)}
                  </Link>
                </td>
                <td className="py-1.5 pr-3 text-right font-mono">{formatEloWithUncertainty(rating.elo, rating.uncertainty)}</td>
                <td className="py-1.5 pr-3">{v.is_winner ? '🏆' : ''}</td>
                <td className="py-1.5 text-[var(--text-muted)]">{new Date(v.created_at).toLocaleDateString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center text-xs">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 border border-[var(--border-default)] rounded disabled:opacity-30">Prev</button>
          <span className="px-2 py-1 text-[var(--text-muted)]">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2 py-1 border border-[var(--border-default)] rounded disabled:opacity-30">Next</button>
        </div>
      )}
    </div>
  );
}

// ─── Runs Tab ─────────────────────────────────────────────────

function TacticRunsTab({ tacticName }: { tacticName: string }) {
  const [items, setItems] = useState<Array<{ id: string; status: string; strategy_id: string; budget_cap_usd: number; created_at: string; completed_at: string | null }>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getTacticRunsAction({ tacticName, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    if (result.success && result.data) {
      setItems(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [tacticName, page]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-sm text-[var(--text-muted)] p-4">Loading runs...</div>;
  if (items.length === 0) return <div className="text-sm text-[var(--text-muted)] p-4">No runs found for this tactic.</div>;

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const statusColor: Record<string, string> = {
    completed: 'text-[var(--status-success)]',
    running: 'text-[var(--status-warning)]',
    failed: 'text-[var(--status-error)]',
    pending: 'text-[var(--text-muted)]',
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-[var(--text-muted)]">{total} runs</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-[var(--border-default)]">
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">ID</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">Status</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)] text-right">Budget</th>
            <th className="py-1.5 font-ui text-[var(--text-muted)]">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map(r => (
            <tr key={r.id} className="border-b border-[var(--border-subtle)] last:border-0">
              <td className="py-1.5 pr-3 font-mono">
                <Link href={`/admin/evolution/runs/${r.id}`} className="text-[var(--accent-gold)] hover:underline">
                  {r.id.slice(0, 8)}
                </Link>
              </td>
              <td className={`py-1.5 pr-3 font-ui ${statusColor[r.status] ?? ''}`}>● {r.status}</td>
              <td className="py-1.5 pr-3 text-right font-mono">${r.budget_cap_usd?.toFixed(2) ?? '—'}</td>
              <td className="py-1.5 text-[var(--text-muted)]">{new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <div className="flex gap-2 justify-center text-xs">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 border border-[var(--border-default)] rounded disabled:opacity-30">Prev</button>
          <span className="px-2 py-1 text-[var(--text-muted)]">{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-2 py-1 border border-[var(--border-default)] rounded disabled:opacity-30">Next</button>
        </div>
      )}
    </div>
  );
}

interface Props {
  tactic: TacticDetailRow;
}

export function TacticDetailContent({ tactic }: Props) {
  const [activeTab, setActiveTab] = useTabState(TABS);

  const statusBadge = (
    <span className={`text-xs px-1.5 py-0.5 rounded ${tactic.is_predefined ? 'bg-blue-900/30 text-blue-300' : 'bg-green-900/30 text-green-300'}`}>
      {tactic.is_predefined ? 'System' : 'Custom'}
    </span>
  );

  return (
    <div className="space-y-6">
      <EntityDetailHeader
        title={tactic.name}
        entityId={tactic.id}
        statusBadge={statusBadge}
      />

      <EntityDetailTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <span className="text-[var(--text-muted)]">Agent Type:</span>{' '}
                  <span className="font-mono">{tactic.agent_type}</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)]">Category:</span>{' '}
                  <span>{tactic.category ?? '—'}</span>
                </div>
              </div>
            </div>

            {tactic.preamble && (
              <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
                <h3 className="font-ui text-sm font-semibold text-[var(--text-primary)] mb-2">Preamble</h3>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{tactic.preamble}</p>
              </div>
            )}

            {tactic.instructions && (
              <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
                <h3 className="font-ui text-sm font-semibold text-[var(--text-primary)] mb-2">Instructions</h3>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{tactic.instructions}</p>
              </div>
            )}

            {!tactic.preamble && !tactic.instructions && (
              <div className="rounded-book border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 text-center text-[var(--text-muted)] text-sm">
                Custom tactic — prompt not defined in code registry.
              </div>
            )}

            <div className="text-xs text-[var(--text-muted)]">
              {tactic.is_predefined
                ? 'Read-only — system-defined tactic. Prompt source: git-controlled code.'
                : 'Custom tactic — created via admin UI.'}
            </div>
          </div>
        )}

        {activeTab === 'metrics' && (
          <EntityMetricsTab entityType="tactic" entityId={tactic.id} />
        )}

        {activeTab === 'variants' && (
          <TacticVariantsTab tacticName={tactic.name} />
        )}

        {activeTab === 'runs' && (
          <TacticRunsTab tacticName={tactic.name} />
        )}

        {activeTab === 'by-prompt' && (
          <TacticPromptPerformanceTable tacticName={tactic.name} />
        )}
      </EntityDetailTabs>
    </div>
  );
}
