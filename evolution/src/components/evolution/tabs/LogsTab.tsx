'use client';
// Logs tab showing per-run structured log entries with filter chips, pagination,
// search, time-delta, inline cost badges, and collapsible tree view for context.

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAutoRefresh } from '@evolution/components/evolution/AutoRefreshProvider';
import {
  getEvolutionRunLogsAction,
  type RunLogEntry,
  type RunLogFilters,
} from '@evolution/services/evolutionActions';
import { formatCostMicro } from '@evolution/lib/utils/formatters';

/** Color mapping for log levels. */
const LEVEL_COLORS: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  debug: 'text-[var(--text-muted)]',
};

const LEVEL_BG: Record<string, string> = {
  info: 'bg-blue-500/10',
  warn: 'bg-amber-500/10',
  error: 'bg-red-500/10',
  debug: 'bg-[var(--surface-secondary)]',
};

const PAGE_SIZE = 500;

interface LogsTabProps {
  runId: string;
  /** Pre-set filters from URL params (cross-linking). */
  initialAgent?: string;
  initialIteration?: number;
  initialVariant?: string;
}

export function LogsTab({ runId, initialAgent, initialIteration, initialVariant }: LogsTabProps) {
  const { refreshKey, isActive, reportRefresh, reportError } = useAutoRefresh();
  const [logs, setLogs] = useState<RunLogEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const initialLoad = useRef(true);

  // Filters
  const [levelFilter, setLevelFilter] = useState<string | undefined>();
  const [agentFilter, setAgentFilter] = useState<string | undefined>(initialAgent);
  const [iterationFilter, setIterationFilter] = useState<number | undefined>(initialIteration);
  const [variantFilter, setVariantFilter] = useState<string | undefined>(initialVariant);

  // Pagination
  const [page, setPage] = useState(0);

  // Client-side search
  const [searchQuery, setSearchQuery] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    const filters: RunLogFilters = {};
    if (levelFilter) filters.level = levelFilter;
    if (agentFilter) filters.agentName = agentFilter;
    if (iterationFilter !== undefined) filters.iteration = iterationFilter;
    if (variantFilter) filters.variantId = variantFilter;
    filters.limit = PAGE_SIZE;
    filters.offset = page * PAGE_SIZE;

    const result = await getEvolutionRunLogsAction({ runId, filters });
    if (result.success) {
      setLogs(result.data?.items ?? []);
      setTotal(result.data?.total ?? null);
      setError(null);
      reportRefresh();
    } else {
      const msg = result.error?.message ?? 'Failed to load logs';
      setError(msg);
      if (!initialLoad.current) reportError(msg);
    }
    if (initialLoad.current) { setLoading(false); initialLoad.current = false; }
  }, [runId, levelFilter, agentFilter, iterationFilter, variantFilter, page, reportRefresh, reportError]);

  // Initial load + filter changes + shared refresh tick
  useEffect(() => {
    if (initialLoad.current) setLoading(true);
    fetchLogs();
  }, [fetchLogs, refreshKey]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [levelFilter, agentFilter, iterationFilter, variantFilter]);

  // Auto-scroll to bottom on new logs while active
  useEffect(() => {
    if (isActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isActive]);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearFilters = () => {
    setLevelFilter(undefined);
    setAgentFilter(undefined);
    setIterationFilter(undefined);
    setVariantFilter(undefined);
    setSearchQuery('');
  };

  const hasFilters = levelFilter || agentFilter || iterationFilter !== undefined || variantFilter || searchQuery;

  // Client-side search filter
  const filteredLogs = useMemo(() => {
    if (!searchQuery) return logs;
    const q = searchQuery.toLowerCase();
    return logs.filter(l => l.message.toLowerCase().includes(q));
  }, [logs, searchQuery]);

  // Collect unique agents and iterations for filter chips
  const agents = [...new Set(logs.map(l => l.agent_name).filter(Boolean))] as string[];
  const iterations = [...new Set(logs.map(l => l.iteration).filter((n): n is number => n !== null))].sort((a, b) => a - b);

  // Pagination
  const totalPages = total !== null ? Math.ceil(total / PAGE_SIZE) : 1;
  const rangeStart = page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, total ?? logs.length);

  if (loading && logs.length === 0) return <LogsSkeleton />;
  if (error) return <div className="text-[var(--status-error)] text-sm p-4">{error}</div>;

  return (
    <div className="space-y-3" data-testid="logs-tab">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* Level filters */}
        {['info', 'warn', 'error', 'debug'].map(level => (
          <button
            key={level}
            onClick={() => setLevelFilter(levelFilter === level ? undefined : level)}
            className={`px-2 py-1 rounded-full border transition-colors ${
              levelFilter === level
                ? `${LEVEL_BG[level]} border-current ${LEVEL_COLORS[level]}`
                : 'border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {level}
          </button>
        ))}

        {/* Quick preset: errors only */}
        <button
          onClick={() => {
            setLevelFilter(levelFilter === 'error' ? undefined : 'error');
            setAgentFilter(undefined);
            setIterationFilter(undefined);
          }}
          className={`px-2 py-1 rounded-full border transition-colors ${
            levelFilter === 'error' && !agentFilter && iterationFilter === undefined
              ? 'bg-red-500/10 border-red-400 text-red-400'
              : 'border-[var(--border-default)] text-[var(--text-muted)] hover:text-red-400'
          }`}
          data-testid="errors-only-preset"
        >
          Errors only
        </button>

        <span className="mx-1 text-[var(--border-default)]">|</span>

        {/* Search box */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search messages..."
          className="px-2 py-1 rounded border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-secondary)] text-xs w-40"
          data-testid="log-search"
        />

        {/* Agent filter dropdown */}
        {agents.length > 0 && (
          <select
            value={agentFilter ?? ''}
            onChange={(e) => setAgentFilter(e.target.value || undefined)}
            className="px-2 py-1 rounded border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-secondary)] text-xs"
          >
            <option value="">All agents</option>
            {agents.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}

        {/* Iteration filter dropdown */}
        {iterations.length > 0 && (
          <select
            value={iterationFilter ?? ''}
            onChange={(e) => setIterationFilter(e.target.value ? Number(e.target.value) : undefined)}
            className="px-2 py-1 rounded border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-secondary)] text-xs"
          >
            <option value="">All iterations</option>
            {iterations.map(i => <option key={i} value={i}>Iteration {i}</option>)}
          </select>
        )}

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="px-2 py-1 text-[var(--accent-gold)] hover:underline"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-[var(--text-muted)]">
          {total !== null && total > PAGE_SIZE
            ? `${rangeStart}–${rangeEnd} of ${total}`
            : `${filteredLogs.length} entries`}
        </span>

        {/* Export dropdown */}
        {filteredLogs.length > 0 && (
          <ExportButton logs={filteredLogs} runId={runId} />
        )}
      </div>

      {/* Pagination controls */}
      {total !== null && total > PAGE_SIZE && (
        <div className="flex items-center gap-2 text-xs" data-testid="pagination">
          <button
            onClick={() => setPage(0)}
            disabled={page === 0}
            className="px-2 py-1 rounded border border-[var(--border-default)] disabled:opacity-30 hover:bg-[var(--surface-elevated)]"
          >
            First
          </button>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 rounded border border-[var(--border-default)] disabled:opacity-30 hover:bg-[var(--surface-elevated)]"
          >
            Prev
          </button>
          <span className="text-[var(--text-muted)]">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 rounded border border-[var(--border-default)] disabled:opacity-30 hover:bg-[var(--surface-elevated)]"
          >
            Next
          </button>
          <button
            onClick={() => setPage(totalPages - 1)}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 rounded border border-[var(--border-default)] disabled:opacity-30 hover:bg-[var(--surface-elevated)]"
          >
            Last
          </button>
        </div>
      )}

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="max-h-[600px] overflow-y-auto space-y-0.5 font-mono text-xs"
        data-testid="log-entries"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-muted)]">
            No log entries{hasFilters ? ' matching filters' : ' yet'}
          </div>
        ) : (
          filteredLogs.map((entry, idx) => {
            const prevEntry = idx > 0 ? filteredLogs[idx - 1] : null;
            const timeDelta = prevEntry
              ? ((new Date(entry.created_at).getTime() - new Date(prevEntry.created_at).getTime()) / 1000)
              : null;
            const costValue = extractCost(entry.context);

            return (
              <div
                key={entry.id}
                className={`group px-3 py-1.5 rounded hover:bg-[var(--surface-elevated)] cursor-pointer ${LEVEL_BG[entry.level] ?? ''}`}
                onClick={() => entry.context && toggleExpand(entry.id)}
                data-testid={`log-entry-${entry.id}`}
              >
                <div className="flex items-start gap-2">
                  {/* Timestamp */}
                  <span className="text-[var(--text-muted)] whitespace-nowrap shrink-0">
                    {new Date(entry.created_at).toLocaleTimeString()}
                  </span>

                  {/* Time delta */}
                  {timeDelta !== null && (
                    <span
                      className={`whitespace-nowrap shrink-0 ${timeDelta > 10 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}
                      data-testid="time-delta"
                    >
                      +{formatTimeDelta(timeDelta)}
                    </span>
                  )}

                  {/* Level badge */}
                  <span className={`${LEVEL_COLORS[entry.level] ?? ''} uppercase font-bold w-12 shrink-0`}>
                    {entry.level}
                  </span>

                  {/* Agent + iteration context */}
                  {entry.agent_name && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAgentFilter(entry.agent_name!); }}
                      className="text-[var(--accent-gold)] hover:underline shrink-0"
                      title={`Filter by ${entry.agent_name}`}
                    >
                      [{entry.agent_name}]
                    </button>
                  )}
                  {entry.iteration !== null && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setIterationFilter(entry.iteration!); }}
                      className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] shrink-0"
                      title={`Filter by iteration ${entry.iteration}`}
                    >
                      i{entry.iteration}
                    </button>
                  )}

                  {/* Message */}
                  <span className="text-[var(--text-primary)] break-all">{entry.message}</span>

                  {/* Inline cost badge (prefer column, fall back to context) */}
                  {(entry.cost_usd ?? costValue) !== null && (
                    <span
                      className="ml-1 px-1.5 py-0.5 rounded bg-[var(--surface-elevated)] text-[var(--accent-gold)] shrink-0"
                      data-testid="inline-cost"
                    >
                      {formatCostMicro((entry.cost_usd ?? costValue)!)}
                    </span>
                  )}

                  {/* Inline duration badge */}
                  {entry.duration_ms != null && (
                    <span
                      className="ml-1 px-1.5 py-0.5 rounded bg-[var(--surface-elevated)] text-[var(--text-muted)] shrink-0"
                      data-testid="inline-duration"
                    >
                      {entry.duration_ms < 1000 ? `${entry.duration_ms}ms` : `${(entry.duration_ms / 1000).toFixed(1)}s`}
                    </span>
                  )}

                  {/* Request ID badge */}
                  {entry.request_id && (
                    <span
                      className="ml-1 px-1.5 py-0.5 rounded bg-[var(--surface-secondary)] text-[var(--text-muted)] shrink-0 font-mono"
                      data-testid="request-id"
                      title={entry.request_id}
                    >
                      req:{entry.request_id.substring(0, 6)}
                    </span>
                  )}

                  {/* Expand indicator */}
                  {entry.context && (
                    <span className="ml-auto text-[var(--text-muted)] opacity-0 group-hover:opacity-100 shrink-0">
                      {expandedIds.has(entry.id) ? '▼' : '▶'}
                    </span>
                  )}
                </div>

                {/* Expanded context — tree view */}
                {expandedIds.has(entry.id) && entry.context && (
                  <div className="mt-1 ml-14 p-2 bg-[var(--surface-secondary)] rounded overflow-x-auto" data-testid="context-tree">
                    <ContextTree data={entry.context} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

/** Extract cost from context JSON (looks for common cost field names). */
function extractCost(context: Record<string, unknown> | null): number | null {
  if (!context) return null;
  for (const key of ['cost', 'costUsd', 'cost_usd', 'totalCost', 'total_cost']) {
    const val = context[key];
    if (typeof val === 'number' && val > 0) return val;
  }
  return null;
}

/** Format seconds into human-readable delta. */
function formatTimeDelta(seconds: number): string {
  if (seconds < 0.1) return '<0.1s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m${s}s`;
}

// ─── Context Tree View ──────────────────────────────────────────

function ContextTree({ data }: { data: unknown }): JSX.Element {
  if (data === null || data === undefined) {
    return <span className="text-[var(--text-muted)]">null</span>;
  }
  if (typeof data === 'boolean') {
    return <span className="text-blue-400">{String(data)}</span>;
  }
  if (typeof data === 'number') {
    return <span className="text-amber-400">{data}</span>;
  }
  if (typeof data === 'string') {
    return <span className="text-green-400">&quot;{data}&quot;</span>;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-[var(--text-muted)]">[]</span>;
    return (
      <div className="pl-3 border-l border-[var(--border-default)]">
        {data.map((item, i) => (
          <div key={i} className="flex items-start gap-1">
            <span className="text-[var(--text-muted)] shrink-0">{i}:</span>
            <ContextTree data={item} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-[var(--text-muted)]">{'{}'}</span>;
    return (
      <div className="pl-3 border-l border-[var(--border-default)]">
        {entries.map(([key, value]) => (
          <ContextTreeNode key={key} label={key} value={value} />
        ))}
      </div>
    );
  }
  return <span className="text-[var(--text-muted)]">{String(data)}</span>;
}

function ContextTreeNode({ label, value }: { label: string; value: unknown }): JSX.Element {
  const isComplex = typeof value === 'object' && value !== null;
  const [open, setOpen] = useState(true);

  return (
    <div>
      <div
        className={`flex items-start gap-1 ${isComplex ? 'cursor-pointer hover:bg-[var(--surface-elevated)] rounded' : ''}`}
        onClick={isComplex ? () => setOpen(!open) : undefined}
      >
        {isComplex && (
          <span className="text-[var(--text-muted)] shrink-0 w-3">{open ? '▼' : '▶'}</span>
        )}
        <span className="text-[var(--text-secondary)] shrink-0">{label}:</span>
        {!isComplex && <ContextTree data={value} />}
        {isComplex && !open && (
          <span className="text-[var(--text-muted)]">
            {Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value as object).length}}`}
          </span>
        )}
      </div>
      {isComplex && open && <ContextTree data={value} />}
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────

const CSV_COLUMNS = ['created_at', 'level', 'agent_name', 'iteration', 'variant_id', 'request_id', 'cost_usd', 'duration_ms', 'message'] as const;

/** Escape a value for CSV (RFC 4180). */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportAsJson(logs: RunLogEntry[], runId: string) {
  const payload = {
    run_id: runId,
    exported_at: new Date().toISOString(),
    count: logs.length,
    entries: logs,
  };
  downloadFile(JSON.stringify(payload, null, 2), `logs-${runId.substring(0, 8)}.json`, 'application/json');
}

function exportAsCsv(logs: RunLogEntry[], runId: string) {
  const header = CSV_COLUMNS.join(',');
  const rows = logs.map(entry =>
    CSV_COLUMNS.map(col => csvEscape(entry[col])).join(',')
  );
  const content = `# Run: ${runId}\n# Exported: ${new Date().toISOString()}\n# Count: ${logs.length}\n${header}\n${rows.join('\n')}`;
  downloadFile(content, `logs-${runId.substring(0, 8)}.csv`, 'text/csv');
}

function ExportButton({ logs, runId }: { logs: RunLogEntry[]; runId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref} data-testid="export-dropdown">
      <button
        onClick={() => setOpen(!open)}
        className="px-2 py-1 rounded border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] transition-colors"
        data-testid="export-btn"
      >
        Export ▾
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded shadow-warm-lg min-w-[120px]">
          <button
            onClick={() => { exportAsJson(logs, runId); setOpen(false); }}
            className="block w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
            data-testid="export-json"
          >
            JSON (full)
          </button>
          <button
            onClick={() => { exportAsCsv(logs, runId); setOpen(false); }}
            className="block w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]"
            data-testid="export-csv"
          >
            CSV (flat)
          </button>
        </div>
      )}
    </div>
  );
}

function LogsSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="h-6 bg-[var(--surface-elevated)] rounded animate-pulse" />
      ))}
    </div>
  );
}
