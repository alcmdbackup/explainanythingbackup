// Shared log viewer component for any evolution entity type.
// Fetches logs via getEntityLogsAction with filter bar, pagination, entity-type badges, and JSON context viewer.
'use client';

import { Fragment, useEffect, useState, useCallback } from 'react';
import { getEntityLogsAction, type LogEntry, type LogFilters } from '@evolution/services/logActions';
import type { EntityType } from '@evolution/lib/core/types';

interface LogsTabProps {
  entityType: EntityType;
  entityId: string;
}

const LEVELS = ['', 'info', 'warn', 'error', 'debug'] as const;
const ENTITY_TYPES = ['', 'run', 'invocation', 'experiment', 'strategy'] as const;
const PAGE_SIZE = 100;

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-blue-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  debug: 'text-[var(--text-muted)]',
};

const ENTITY_BADGE_COLORS: Record<string, string> = {
  run: 'bg-blue-900/30 text-blue-300',
  invocation: 'bg-purple-900/30 text-purple-300',
  experiment: 'bg-green-900/30 text-green-300',
  strategy: 'bg-amber-900/30 text-amber-300',
};

export function LogsTab({ entityType, entityId }: LogsTabProps): JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [maxIterationSeen, setMaxIterationSeen] = useState(0);
  const [jumpInput, setJumpInput] = useState('');

  // Filters
  const [levelFilter, setLevelFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [iterationFilter, setIterationFilter] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [variantIdFilter, setVariantIdFilter] = useState('');
  const [debouncedMessage, setDebouncedMessage] = useState('');
  const [debouncedAgent, setDebouncedAgent] = useState('');
  const [debouncedVariantId, setDebouncedVariantId] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMessage(messageSearch), 300);
    return () => clearTimeout(timer);
  }, [messageSearch]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedAgent(agentFilter), 300);
    return () => clearTimeout(timer);
  }, [agentFilter]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedVariantId(variantIdFilter), 300);
    return () => clearTimeout(timer);
  }, [variantIdFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    const filters: LogFilters = { limit: PAGE_SIZE, offset };
    if (levelFilter) filters.level = levelFilter;
    if (entityTypeFilter) filters.entityType = entityTypeFilter;
    if (debouncedAgent) filters.agentName = debouncedAgent;
    if (iterationFilter) filters.iteration = parseInt(iterationFilter, 10);
    if (debouncedVariantId) filters.variantId = debouncedVariantId;
    if (debouncedMessage) filters.messageSearch = debouncedMessage;

    const result = await getEntityLogsAction({ entityType, entityId, filters });
    if (result.success && result.data) {
      setLogs(result.data.items);
      setTotal(result.data.total);
      // Track max iteration across all fetches so the filter dropdown isn't limited to current page
      const pageMax = result.data.items.reduce((max, l) => (l.iteration != null && l.iteration > max ? l.iteration : max), 0);
      setMaxIterationSeen(prev => Math.max(prev, pageMax));
    }
    setLoading(false);
  }, [entityType, entityId, offset, levelFilter, entityTypeFilter, debouncedAgent, iterationFilter, debouncedVariantId, debouncedMessage]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset offset when filters change (use debounced values for text inputs)
  useEffect(() => {
    setOffset(0);
  }, [levelFilter, entityTypeFilter, debouncedAgent, iterationFilter, debouncedVariantId, debouncedMessage]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-3" data-testid="logs-tab">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="text-xs px-2 py-1 rounded bg-[var(--surface-input)] border border-[var(--border-default)] text-[var(--text-primary)]"
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            aria-label="Filter by level"
          >
            <option value="">All levels</option>
            {LEVELS.filter(Boolean).map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          {entityType !== 'invocation' && (
            <select
              className="text-xs px-2 py-1 rounded bg-[var(--surface-input)] border border-[var(--border-default)] text-[var(--text-primary)]"
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              aria-label="Filter by entity type"
            >
              <option value="">All entities</option>
              {ENTITY_TYPES.filter(Boolean).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          )}

          <input
            type="text"
            className="text-xs px-2 py-1 rounded bg-[var(--surface-input)] border border-[var(--border-default)] text-[var(--text-primary)] w-32"
            placeholder="Agent/phase..."
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            aria-label="Filter by agent name"
          />

          <select
            className="text-xs px-2 py-1 rounded bg-[var(--surface-input)] border border-[var(--border-default)] text-[var(--text-primary)]"
            value={iterationFilter}
            onChange={(e) => setIterationFilter(e.target.value)}
            aria-label="Filter by iteration"
          >
            <option value="">All iterations</option>
            {Array.from(
              { length: Math.max(maxIterationSeen, 1) + 1 },
              (_, i) => <option key={i} value={String(i)}>{i}</option>,
            )}
          </select>

          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {total} log{total !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            className="text-xs px-2 py-1 rounded bg-[var(--surface-input)] border border-[var(--border-default)] text-[var(--text-primary)] w-48"
            placeholder="Search messages..."
            value={messageSearch}
            onChange={(e) => setMessageSearch(e.target.value)}
            aria-label="Search messages"
          />

          <input
            type="text"
            className="text-xs px-2 py-1 rounded bg-[var(--surface-input)] border border-[var(--border-default)] text-[var(--text-primary)] w-40"
            placeholder="Variant ID..."
            value={variantIdFilter}
            onChange={(e) => setVariantIdFilter(e.target.value)}
            aria-label="Filter by variant ID"
          />
        </div>
      </div>

      {loading && (
        <div className="h-48 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      )}

      {!loading && logs.length === 0 && (
        <div className="text-sm text-[var(--text-muted)] p-8 text-center">No logs available.</div>
      )}

      {!loading && logs.length > 0 && (
        <div className="overflow-x-auto border border-[var(--border-default)] rounded-book">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-elevated)]">
              <tr>
                <th className="px-3 py-2 text-left text-xs">Time</th>
                <th className="px-3 py-2 text-left text-xs">Level</th>
                <th className="px-3 py-2 text-left text-xs">Source</th>
                <th className="px-3 py-2 text-left text-xs">Agent</th>
                <th className="px-3 py-2 text-left text-xs">Message</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <Fragment key={log.id}>
                  <tr
                    className="border-t border-[var(--border-default)] cursor-pointer hover:bg-[var(--surface-elevated)]"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td className="px-3 py-2 text-xs text-[var(--text-muted)] whitespace-nowrap">
                      {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(log.created_at))}
                    </td>
                    <td className={`px-3 py-2 text-xs font-mono ${LEVEL_COLORS[log.level] ?? ''}`}>
                      {log.level}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-mono ${ENTITY_BADGE_COLORS[log.entity_type] ?? 'bg-gray-800 text-gray-300'}`}>
                        {log.entity_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)]">
                      {log.agent_name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">{log.message}</td>
                  </tr>
                  {expandedId === log.id && log.context && (
                    <tr>
                      <td colSpan={5} className="p-3 bg-[var(--surface-elevated)] text-xs font-mono overflow-x-auto">
                        <pre className="text-[var(--text-secondary)]">{JSON.stringify(log.context, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <button
            className="px-3 py-1 rounded border border-[var(--border-default)] disabled:opacity-40"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Previous
          </button>
          <span>Page {currentPage} of {totalPages}</span>
          <button
            className="px-3 py-1 rounded border border-[var(--border-default)] disabled:opacity-40"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next
          </button>
          <button
            className="px-3 py-1 rounded border border-[var(--border-default)] disabled:opacity-40"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((totalPages - 1) * PAGE_SIZE)}
            aria-label="Last page"
          >
            Last
          </button>
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(jumpInput, 10);
              if (!isNaN(n)) { setOffset((Math.max(1, Math.min(n, totalPages)) - 1) * PAGE_SIZE); }
              setJumpInput('');
            }}
          >
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpInput}
              onChange={(e) => setJumpInput(e.target.value)}
              placeholder="Page"
              aria-label="Jump to page"
              className="w-14 px-2 py-1 rounded border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button type="submit" className="px-2 py-1 rounded border border-[var(--border-default)]">Go</button>
          </form>
        </div>
      )}
    </div>
  );
}
