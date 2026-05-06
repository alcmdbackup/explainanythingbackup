'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { EntityDetailHeader, EntityDetailTabs, useTabState, EvolutionBreadcrumb } from '@evolution/components/evolution';
import { EntityMetricsTab } from '@evolution/components/evolution/tabs/EntityMetricsTab';
import {
  getCriteriaDetailAction,
  getCriteriaVariantsAction,
  getCriteriaRunsAction,
  type CriteriaListItem,
  type CriteriaVariantRow,
  type CriteriaRunRow,
} from '@evolution/services/criteriaActions';
import type { TabDef } from '@evolution/lib/core/types';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'variants', label: 'Variants' },
  { id: 'runs', label: 'Runs' },
  { id: 'by-prompt', label: 'By Prompt' },
];

function OverviewTab({ row }: { row: CriteriaListItem }): JSX.Element {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-ui font-semibold text-[var(--text-secondary)] mb-1">Description</h3>
        <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
          {row.description || <span className="text-[var(--text-muted)] italic">No description.</span>}
        </p>
      </section>

      <section className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <h4 className="text-xs font-ui text-[var(--text-muted)] mb-1">Range</h4>
          <p>{row.min_rating} – {row.max_rating}</p>
        </div>
        <div>
          <h4 className="text-xs font-ui text-[var(--text-muted)] mb-1">Status</h4>
          <p>{row.status}</p>
        </div>
        <div>
          <h4 className="text-xs font-ui text-[var(--text-muted)] mb-1">Created</h4>
          <p>{new Date(row.created_at).toLocaleDateString()}</p>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-ui font-semibold text-[var(--text-secondary)] mb-2">Evaluation Guidance</h3>
        {row.evaluation_guidance && row.evaluation_guidance.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {[...row.evaluation_guidance].sort((a, b) => a.score - b.score).map((anchor, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-[var(--accent-gold)] w-8 shrink-0">{anchor.score}</span>
                <span>—</span>
                <span className="text-[var(--text-secondary)]">{anchor.description}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-muted)] italic">No rubric defined. The LLM receives only name + description + range.</p>
        )}
      </section>
    </div>
  );
}

function VariantsTab({ criteriaId }: { criteriaId: string }): JSX.Element {
  const [items, setItems] = useState<CriteriaVariantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getCriteriaVariantsAction({ criteriaId, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    if (result.success && result.data) {
      setItems(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [criteriaId, page]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-sm text-[var(--text-muted)] p-4">Loading variants...</div>;
  if (items.length === 0) return <div className="text-sm text-[var(--text-muted)] p-4">No variants found where this criterion was the focus.</div>;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="text-xs text-[var(--text-muted)]">{total} variants where this criterion was in weakest_criteria_ids</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-[var(--border-default)]">
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">ID</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">Run</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)] text-right">Elo</th>
            <th className="py-1.5 font-ui text-[var(--text-muted)]">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map(v => (
            <tr key={v.id} className="border-b border-[var(--border-subtle)] last:border-0">
              <td className="py-1.5 pr-3 font-mono">
                <Link href={`/admin/evolution/variants/${v.id}`} className="text-[var(--accent-gold)] hover:underline">{v.id.slice(0, 8)}</Link>
              </td>
              <td className="py-1.5 pr-3 font-mono">
                <Link href={`/admin/evolution/runs/${v.run_id}`} className="text-[var(--accent-gold)] hover:underline">{v.run_id.slice(0, 8)}</Link>
              </td>
              <td className="py-1.5 pr-3 text-right font-mono">{v.elo_score?.toFixed(0) ?? '—'}</td>
              <td className="py-1.5 text-[var(--text-muted)]">{new Date(v.created_at).toLocaleDateString()}</td>
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

function RunsTab({ criteriaId }: { criteriaId: string }): JSX.Element {
  const [items, setItems] = useState<CriteriaRunRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getCriteriaRunsAction({ criteriaId, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    if (result.success && result.data) {
      setItems(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [criteriaId, page]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-sm text-[var(--text-muted)] p-4">Loading runs...</div>;
  if (items.length === 0) return <div className="text-sm text-[var(--text-muted)] p-4">No runs have referenced this criterion yet.</div>;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="text-xs text-[var(--text-muted)]">{total} runs that produced variants focused on this criterion</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left border-b border-[var(--border-default)]">
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">Run</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)]">Status</th>
            <th className="py-1.5 pr-3 font-ui text-[var(--text-muted)] text-right">Variants Focused</th>
            <th className="py-1.5 font-ui text-[var(--text-muted)]">Created</th>
          </tr>
        </thead>
        <tbody>
          {items.map(r => (
            <tr key={r.id} className="border-b border-[var(--border-subtle)] last:border-0">
              <td className="py-1.5 pr-3 font-mono">
                <Link href={`/admin/evolution/runs/${r.id}`} className="text-[var(--accent-gold)] hover:underline">{r.id.slice(0, 8)}</Link>
              </td>
              <td className="py-1.5 pr-3">{r.status}</td>
              <td className="py-1.5 pr-3 text-right font-mono">{r.variants_focused_count}</td>
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

function ByPromptTab(): JSX.Element {
  // Placeholder for v1: per-prompt aggregation requires a JOIN through runs → prompt_id
  // and groupBy in JS. Mirrors TacticPromptPerformanceTable; deferred to follow-up PR.
  return (
    <div className="text-sm text-[var(--text-muted)] italic p-4">
      Per-prompt aggregation coming soon. Use the Variants tab to inspect individual variants and click through to their runs.
    </div>
  );
}

export function CriteriaDetailContent({ criteriaId }: { criteriaId: string }): JSX.Element {
  const [row, setRow] = useState<CriteriaListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useTabState(TABS);

  useEffect(() => {
    (async () => {
      const result = await getCriteriaDetailAction(criteriaId);
      if (result.success && result.data) setRow(result.data);
      else setError(result.error?.message ?? 'Criteria not found');
      setLoading(false);
    })();
  }, [criteriaId]);

  if (loading) return <div className="p-8 text-center text-sm text-[var(--text-secondary)]">Loading criteria...</div>;
  if (error || !row) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-display font-bold text-[var(--status-error)] mb-4">Error</h2>
        <p className="text-sm text-[var(--text-secondary)]">{error ?? 'Criteria not found'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb items={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Criteria', href: '/admin/evolution/criteria' },
        { label: row.name },
      ]} />

      <EntityDetailHeader
        title={row.name}
        entityId={row.id}
        statusBadge={
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
              row.status === 'active'
                ? 'bg-[var(--status-success)]/20 text-[var(--status-success)] border-[var(--status-success)]/30'
                : 'bg-[var(--text-muted)]/20 text-[var(--text-muted)] border-[var(--text-muted)]/30'
            }`}
            data-testid="criteria-status-badge"
          >
            {row.status}
          </span>
        }
      />

      <EntityDetailTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === 'overview' && <OverviewTab row={row} />}
        {activeTab === 'metrics' && <EntityMetricsTab entityType="criteria" entityId={criteriaId} />}
        {activeTab === 'variants' && <VariantsTab criteriaId={criteriaId} />}
        {activeTab === 'runs' && <RunsTab criteriaId={criteriaId} />}
        {activeTab === 'by-prompt' && <ByPromptTab />}
      </EntityDetailTabs>
    </div>
  );
}
