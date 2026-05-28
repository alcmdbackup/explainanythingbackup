// Extracted leaderboard component (D17) shared between the standalone arena topic
// page and the embedded paragraph-slot view (SlotsTab right pane). Owns its own
// pagination + sort + column-hide state. D20 props: highlightVariantIds (decorate
// rows with ●) and filterToVariantIds (render only matching rows while preserving
// absolute ranks). When filterToVariantIds is set, pagination is bypassed and the
// component fetches up to 50 entries in a single call.
'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ColumnPicker,
  usePersistedHiddenColumns,
} from '../index';
import {
  getArenaEntriesAction,
  type ArenaEntry,
} from '@evolution/services/arenaActions';
import { formatElo, stripMarkdownTitle } from '@evolution/lib/shared/computeRatings';
import { formatEloCIRange, formatEloWithUncertainty } from '@evolution/lib/utils/formatters';
import { computeEloCutoff } from '../../../../../src/app/admin/evolution/arena/[topicId]/arenaCutoff';
import { bootstrapDeltaCI } from '@evolution/lib/shared/ratingDelta';
import { VariantParentBadge } from '../variant/VariantParentBadge';
import { TACTIC_PALETTE } from '@evolution/lib/core/tactics';

const TOGGLEABLE_LEADERBOARD_COLUMNS: { key: string; label: string }[] = [
  { key: '95ci', label: '95% CI' },
  { key: 'elo_unc', label: 'Elo ± Uncertainty' },
  { key: 'matches', label: 'Matches' },
  { key: 'iteration', label: 'Iteration' },
  { key: 'tactic', label: 'Tactic' },
  { key: 'method', label: 'Method' },
  { key: 'parent', label: 'Parent' },
];

const PAGE_SIZE = 20;
// D20: when filterToVariantIds is set, fetch all rows in one call (no pagination).
// Bounded to prevent accidental unbounded fetches on big article topics.
const FILTER_MODE_MAX_FETCH = 50;

function ContentLink({ entryId, content }: { entryId: string; content: string }): JSX.Element {
  const cleaned = stripMarkdownTitle(content);
  const label = cleaned.length > 60 ? `${cleaned.substring(0, 60)}…` : cleaned;
  return (
    <Link href={`/admin/evolution/variants/${entryId}`} className="text-[var(--accent-gold)] hover:underline">
      {label}
    </Link>
  );
}

function ParentBadgeCell({ entry }: { entry: ArenaEntry }): JSX.Element {
  if (!entry.parent_variant_id) {
    return (
      <VariantParentBadge
        parentId={null}
        parentElo={null}
        parentUncertainty={null}
        delta={null}
        deltaCi={null}
      />
    );
  }
  const parentElo = entry.parent_elo ?? null;
  const parentUncertainty = entry.parent_uncertainty ?? null;
  const { delta, ci } = parentElo != null
    ? bootstrapDeltaCI(
        { elo: entry.elo_score, uncertainty: entry.uncertainty ?? 0 },
        { elo: parentElo, uncertainty: parentUncertainty ?? 0 },
      )
    : { delta: null, ci: null };
  return (
    <VariantParentBadge
      parentId={entry.parent_variant_id}
      parentElo={parentElo}
      parentUncertainty={parentUncertainty}
      delta={delta}
      deltaCi={ci}
      crossRun={!!entry.parent_run_id && entry.parent_run_id !== entry.run_id}
      parentRunId={entry.parent_run_id ?? null}
    />
  );
}

function TacticCell({ agentName, tacticId }: { agentName: string | null; tacticId: string | null }): JSX.Element {
  if (!agentName) return <span className="text-[var(--text-muted)]">—</span>;
  const dot = (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: TACTIC_PALETTE[agentName] ?? 'var(--text-muted)' }}
    />
  );
  if (tacticId) {
    return (
      <Link
        href={`/admin/evolution/tactics/${tacticId}`}
        className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--accent-gold)] font-mono text-xs"
      >
        {dot}
        {agentName}
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] font-mono text-xs">
      {dot}
      {agentName}
    </span>
  );
}

type SortKey = 'elo_score' | 'uncertainty' | 'arena_match_count' | 'generation_method' | 'cost_usd' | 'agent_name';

export interface ArenaLeaderboardTableProps {
  topicId: string;
  /** D20: render ● in rank column for matching rows. */
  highlightVariantIds?: ReadonlySet<string>;
  /** D20: render only matching rows; preserve overall rank from full sort. */
  filterToVariantIds?: ReadonlySet<string>;
  /** Local-storage key for column-hide preferences; defaults to standalone arena key. */
  storageKey?: string;
  /** When set, bottom caption appears beneath the table. */
  bottomCaption?: string;
  /** When true, suppresses the default ⓘ Elo-cutoff callout above the table. */
  hideCutoffCallout?: boolean;
}

export function ArenaLeaderboardTable({
  topicId,
  highlightVariantIds,
  filterToVariantIds,
  storageKey = 'evolution-arena-leaderboard-hidden-columns',
  bottomCaption,
  hideCutoffCallout,
}: ArenaLeaderboardTableProps): JSX.Element {
  const [entries, setEntries] = useState<ArenaEntry[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenLbCols, setHiddenLbCols] = usePersistedHiddenColumns(storageKey);

  const [sortKey, setSortKey] = useState<SortKey>('elo_score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const isFilterMode = filterToVariantIds != null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const limit = isFilterMode ? FILTER_MODE_MAX_FETCH : PAGE_SIZE;
      const offset = isFilterMode ? 0 : (page - 1) * PAGE_SIZE;
      const result = await getArenaEntriesAction({ topicId, limit, offset });
      if (cancelled) return;
      if (!result.success || !result.data) {
        setError(result.error?.message ?? 'Failed to load entries');
        setLoading(false);
        return;
      }
      if (isFilterMode && result.data.total > FILTER_MODE_MAX_FETCH) {
        // Runtime assertion per Phase 6 plan: prevents accidental unbounded fetch on big topics.
        throw new Error(
          `ArenaLeaderboardTable: filter mode requires <=${FILTER_MODE_MAX_FETCH} entries; topic ${topicId} has ${result.data.total}`,
        );
      }
      setEntries(result.data.items);
      setTotalEntries(result.data.total);
      setLoading(false);
    }
    load().catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [topicId, page, isFilterMode]);

  const sortedEntries = useMemo(() => {
    const mult = sortDir === 'desc' ? -1 : 1;
    return [...entries].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return mult * av.localeCompare(bv as string);
      return mult * ((av as number) - (bv as number));
    });
  }, [entries, sortKey, sortDir]);

  const eloRankMap = useMemo(() => {
    const byElo = [...entries].sort((a, b) => (b.elo_score ?? 0) - (a.elo_score ?? 0));
    return new Map(byElo.map((e, i) => [e.id, i + 1]));
  }, [entries]);

  const eloCutoff = useMemo(() => computeEloCutoff(entries), [entries]);

  const eligibleSet = useMemo(() => {
    if (eloCutoff == null) return null;
    return new Set(
      entries
        .filter(e => e.elo_score != null && e.elo_score >= eloCutoff)
        .map(e => e.id),
    );
  }, [entries, eloCutoff]);

  const displayedEntries = useMemo(() => {
    if (!filterToVariantIds) return sortedEntries;
    return sortedEntries.filter((e) => filterToVariantIds.has(e.id));
  }, [sortedEntries, filterToVariantIds]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const totalPages = Math.ceil(totalEntries / PAGE_SIZE);

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  const sortableThProps = (key: SortKey) => ({
    className: 'py-2 pr-3 cursor-pointer select-none hover:text-[var(--text-primary)]',
    onClick: () => handleSort(key),
    onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(key); } },
    tabIndex: 0,
    'aria-sort': (sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') as 'ascending' | 'descending' | 'none',
    role: 'columnheader' as const,
  });

  if (loading) {
    return <div className="text-sm font-ui text-[var(--text-muted)] py-4">Loading entries…</div>;
  }
  if (error) {
    return <div className="text-sm font-ui text-[var(--status-error)] py-4">{error}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-wide" data-testid="arena-leaderboard-summary">
          {totalEntries} entries{isFilterMode ? ` · showing ${displayedEntries.length} matching` : ''}
        </div>
        <ColumnPicker
          allColumns={TOGGLEABLE_LEADERBOARD_COLUMNS}
          hidden={hiddenLbCols}
          onChange={setHiddenLbCols}
          testId="arena-leaderboard-column-picker"
        />
      </div>
      {!hideCutoffCallout && eloCutoff != null && (
        <div
          className="flex items-start gap-2 mb-3 p-2 rounded-book bg-[var(--surface-secondary)] border border-[var(--border-subtle)] text-xs font-ui text-[var(--text-secondary)]"
          data-testid="cutoff-info"
          role="note"
        >
          <span aria-hidden="true">ⓘ</span>
          <span>
            Top 15% Elo cutoff: <strong className="font-mono text-[var(--text-primary)]">{formatElo(eloCutoff)}</strong>.
            Rows with lower Elo are <span className="opacity-50">dimmed</span> to highlight contenders.
          </span>
        </div>
      )}
      {displayedEntries.length === 0 ? (
        <div className="text-sm font-ui text-[var(--text-muted)] text-center py-4">
          {isFilterMode ? (
            <p>No matching variants in this topic.</p>
          ) : (
            <>
              <p>No entries yet.</p>
              <p className="mt-1 text-xs">Entries are added automatically when variants compete in this topic.</p>
            </>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-ui" data-testid="leaderboard-table">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)] uppercase tracking-wide border-b border-[var(--border-default)]">
                <th className="py-2 pr-3">Rank</th>
                <th className="py-2 pr-3">Content</th>
                <th className="py-2 pr-3">ID</th>
                <th {...sortableThProps('elo_score')}>Elo{sortIndicator('elo_score')}</th>
                {!hiddenLbCols.has('95ci') && <th className="py-2 pr-3">95% CI</th>}
                {!hiddenLbCols.has('elo_unc') && <th {...sortableThProps('uncertainty')}>Elo ± Uncertainty{sortIndicator('uncertainty')}</th>}
                {!hiddenLbCols.has('matches') && <th {...sortableThProps('arena_match_count')}>Matches{sortIndicator('arena_match_count')}</th>}
                {!hiddenLbCols.has('iteration') && <th className="py-2 pr-3">Iteration</th>}
                {!hiddenLbCols.has('tactic') && <th {...sortableThProps('agent_name')}>Tactic{sortIndicator('agent_name')}</th>}
                {!hiddenLbCols.has('method') && <th {...sortableThProps('generation_method')}>Method{sortIndicator('generation_method')}</th>}
                {!hiddenLbCols.has('parent') && <th className="py-2 pr-3">Parent</th>}
              </tr>
            </thead>
            <tbody>
              {displayedEntries.map((entry, index) => {
                const isEligible = eligibleSet == null || eligibleSet.has(entry.id);
                const isHighlighted = highlightVariantIds?.has(entry.id) ?? false;
                const absoluteRank = eloRankMap.get(entry.id) ?? index + 1;
                return (
                  <tr
                    key={entry.id}
                    data-testid={`lb-row-${index}`}
                    title={isEligible ? undefined : `Below top 15% Elo cutoff (${eloCutoff != null ? formatElo(eloCutoff) : '—'})`}
                    className={`border-b border-[var(--border-default)] last:border-0 hover:bg-[var(--surface-hover)]${isEligible ? '' : ' opacity-50'}`}
                  >
                    <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">
                      {isHighlighted && (
                        <span aria-label="introduced by this invocation" title="introduced by this invocation" className="text-[var(--accent-gold)] mr-1" data-testid="lb-highlight-marker">●</span>
                      )}
                      {absoluteRank}
                    </td>
                    <td className="py-2 pr-3">
                      <ContentLink entryId={entry.id} content={entry.variant_content} />
                    </td>
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="font-mono text-xs text-[var(--text-muted)] hover:text-[var(--accent-gold)] cursor-pointer"
                        title={`${entry.id} (click to copy)`}
                        onClick={() => { void navigator.clipboard?.writeText(entry.id); }}
                        data-testid="lb-variant-id"
                      >
                        {entry.id.substring(0, 8)}
                      </button>
                    </td>
                    <td className="py-2 pr-3 font-mono">{formatElo(entry.elo_score)}</td>
                    {!hiddenLbCols.has('95ci') && (
                      <td className="py-2 pr-3 font-mono text-[var(--text-secondary)]">
                        {entry.elo_score != null && entry.uncertainty != null
                          ? (formatEloCIRange(entry.elo_score, entry.uncertainty) ?? '—')
                          : '—'}
                      </td>
                    )}
                    {!hiddenLbCols.has('elo_unc') && (
                      <td className="py-2 pr-3 font-mono">
                        {entry.elo_score != null && entry.uncertainty != null
                          ? (formatEloWithUncertainty(entry.elo_score, entry.uncertainty) ?? '—')
                          : '—'}
                      </td>
                    )}
                    {!hiddenLbCols.has('matches') && (
                      <td className="py-2 pr-3 font-mono">{entry.arena_match_count}</td>
                    )}
                    {!hiddenLbCols.has('iteration') && (
                      <td className="py-2 pr-3 font-mono text-[var(--text-muted)]">
                        {entry.generation ?? '—'}
                      </td>
                    )}
                    {!hiddenLbCols.has('tactic') && (
                      <td className="py-2 pr-3" data-testid="lb-tactic">
                        <TacticCell agentName={entry.agent_name ?? null} tacticId={entry.tactic_id ?? null} />
                      </td>
                    )}
                    {!hiddenLbCols.has('method') && (
                      <td className="py-2 pr-3 text-[var(--text-secondary)]">
                        {entry.is_seed && (
                          <span
                            className="inline-flex items-center gap-1 mr-1 px-2 py-0.5 text-xs font-bold uppercase tracking-wider rounded-full bg-[var(--accent-gold)] text-[var(--surface-primary)] shadow-warm-sm"
                            data-testid="lb-seed-row-indicator"
                            aria-label="This row is the seed variant"
                          >
                            <span aria-hidden="true">★</span>
                            seed
                          </span>
                        )}
                        {entry.generation_method}
                      </td>
                    )}
                    {!hiddenLbCols.has('parent') && (
                      <td className="py-2 pr-3">
                        <ParentBadgeCell entry={entry} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!isFilterMode && totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-4 border-t border-[var(--border-default)]">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 text-xs font-ui border border-[var(--border-default)] rounded disabled:opacity-40"
              >
                &lsaquo; Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => Math.abs(p - page) <= 3 || p === 1 || p === totalPages)
                .map((p, idx, arr) => {
                  const prev = arr[idx - 1];
                  const showEllipsis = prev != null && p - prev > 1;
                  return (
                    <span key={p}>
                      {showEllipsis && <span className="text-xs text-[var(--text-muted)]">…</span>}
                      <button
                        onClick={() => setPage(p)}
                        className={`px-3 py-1 text-xs font-ui border rounded ${
                          p === page
                            ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)] border-[var(--accent-gold)]'
                            : 'border-[var(--border-default)]'
                        }`}
                      >
                        {p}
                      </button>
                    </span>
                  );
                })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 text-xs font-ui border border-[var(--border-default)] rounded disabled:opacity-40"
              >
                Next &rsaquo;
              </button>
            </div>
          )}
          {bottomCaption && (
            <div className="text-xs font-ui text-[var(--text-muted)] mt-2" data-testid="arena-leaderboard-caption">
              {bottomCaption}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
