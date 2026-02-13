'use client';
// Logs tab showing per-run structured log entries with filter chips and auto-refresh.
// Cross-linkable from Timeline (iteration, agent) and Explorer (variant, run) views.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  getEvolutionRunLogsAction,
  type RunLogEntry,
  type RunLogFilters,
} from '@/lib/services/evolutionActions';

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

interface LogsTabProps {
  runId: string;
  runStatus?: string;
  /** Pre-set filters from URL params (cross-linking). */
  initialAgent?: string;
  initialIteration?: number;
  initialVariant?: string;
}

export function LogsTab({ runId, runStatus, initialAgent, initialIteration, initialVariant }: LogsTabProps) {
  const [logs, setLogs] = useState<RunLogEntry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Filters
  const [levelFilter, setLevelFilter] = useState<string | undefined>();
  const [agentFilter, setAgentFilter] = useState<string | undefined>(initialAgent);
  const [iterationFilter, setIterationFilter] = useState<number | undefined>(initialIteration);
  const [variantFilter, setVariantFilter] = useState<string | undefined>(initialVariant);

  const scrollRef = useRef<HTMLDivElement>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    const filters: RunLogFilters = {};
    if (levelFilter) filters.level = levelFilter;
    if (agentFilter) filters.agentName = agentFilter;
    if (iterationFilter !== undefined) filters.iteration = iterationFilter;
    if (variantFilter) filters.variantId = variantFilter;
    filters.limit = 500;

    const result = await getEvolutionRunLogsAction(runId, filters);
    if (result.success) {
      setLogs(result.data ?? []);
      setTotal(result.total);
      setError(null);
    } else {
      setError(result.error?.message ?? 'Failed to load logs');
    }
    setLoading(false);
  }, [runId, levelFilter, agentFilter, iterationFilter, variantFilter]);

  // Initial load + filter changes
  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 5s while run is active
  useEffect(() => {
    const isActive = runStatus === 'running' || runStatus === 'claimed';
    if (isActive) {
      autoRefreshRef.current = setInterval(fetchLogs, 5000);
    }
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [runStatus, fetchLogs]);

  // Auto-scroll to bottom on new logs while active
  useEffect(() => {
    const isActive = runStatus === 'running' || runStatus === 'claimed';
    if (isActive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, runStatus]);

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
  };

  const hasFilters = levelFilter || agentFilter || iterationFilter !== undefined || variantFilter;

  // Collect unique agents and iterations for filter chips
  const agents = [...new Set(logs.map(l => l.agent_name).filter(Boolean))] as string[];
  const iterations = [...new Set(logs.map(l => l.iteration).filter((n): n is number => n !== null))].sort((a, b) => a - b);

  if (loading) return <LogsSkeleton />;
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

        <span className="mx-1 text-[var(--border-default)]">|</span>

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
          {total !== null ? `${total} entries` : `${logs.length} entries`}
        </span>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="max-h-[600px] overflow-y-auto space-y-0.5 font-mono text-xs"
        data-testid="log-entries"
      >
        {logs.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-muted)]">
            No log entries{hasFilters ? ' matching filters' : ' yet'}
          </div>
        ) : (
          logs.map((entry) => (
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

                {/* Expand indicator */}
                {entry.context && (
                  <span className="ml-auto text-[var(--text-muted)] opacity-0 group-hover:opacity-100 shrink-0">
                    {expandedIds.has(entry.id) ? '▼' : '▶'}
                  </span>
                )}
              </div>

              {/* Expanded context JSON */}
              {expandedIds.has(entry.id) && entry.context && (
                <pre className="mt-1 ml-14 p-2 bg-[var(--surface-secondary)] rounded text-[var(--text-muted)] overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify(entry.context, null, 2)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
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
