// Shared log viewer component for any evolution entity type.
// Fetches logs via getEntityLogsAction with filter bar, pagination, entity-type badges, and JSON context viewer.
'use client';

import { useEffect, useState, useCallback } from 'react';
import { getEntityLogsAction, type LogEntry, type LogFilters } from '@evolution/services/logActions';
import type { EntityType } from '@evolution/lib/core/types';

// ─── Types ───────────────────────────────────────────────────────

interface LogsTabProps {
  entityType: EntityType;
  entityId: string;
}

// ─── Constants ───────────────────────────────────────────────────

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

// ─── Component ───────────────────────────────────────────────────

export function LogsTab({ entityType, entityId }: LogsTabProps): JSX.Element {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Filters
  const [levelFilter, setLevelFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [iterationFilter, setIterationFilter] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [variantIdFilter, setVariantIdFilter] = useState('');
  const [debouncedMessage, setDebouncedMessage] = useState('');

  // Debounce message search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMessage(messageSearch), 300);
    return () => clearTimeout(timer);
  }, [messageSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    const filters: LogFilters = { limit: PAGE_SIZE, offset };
    if (levelFilter) filters.level = levelFilter;
    if (entityTypeFilter) filters.entityType = entityTypeFilter;
    if (agentFilter) filters.agentName = agentFilter;
    if (iterationFilter) filters.iteration = parseInt(iterationFilter, 10);
    if (variantIdFilter) filters.variantId = variantIdFilter;
    if (debouncedMessage) filters.messageSearch = debouncedMessage;

    const result = await getEntityLogsAction({ entityType, entityId, filters });
    if (result.success && result.data) {
      setLogs(result.data.items);
      setTotal(result.data.total);
    }
    setLoading(false);
  }, [entityType, entityId, offset, levelFilter, entityTypeFilter, agentFilter, iterationFilter, variantIdFilter, debouncedMessage]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset offset when filters change
  useEffect(() => {
    setOffset(0);
  }, [levelFilter, entityTypeFilter, agentFilter, iterationFilter, variantIdFilter, debouncedMessage]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-3" data-testid="logs-tab">
      {/* Filter bar — 2 rows */}
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
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
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

      {/* Loading */}
      {loading && (
        <div className="h-48 bg-[var(--surface-elevated)] rounded-book animate-pulse" />
      )}

      {/* Empty state */}
      {!loading && logs.length === 0 && (
        <div className="text-sm text-[var(--text-muted)] p-8 text-center">No logs available.</div>
      )}

      {/* Table */}
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
                <tr
                  key={log.id}
                  className="border-t border-[var(--border-default)] cursor-pointer hover:bg-[var(--surface-elevated)]"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  <td className="px-3 py-2 text-xs text-[var(--text-muted)] whitespace-nowrap">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </td>
                  <td className={`px-3 py-2 text-xs font-mono ${LEVEL_COLORS[log.level] ?? ''}`}>
                    {log.level}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${ENTITY_BADGE_COLORS[log.entity_type] ?? 'bg-gray-800 text-gray-300'}`}>
                      {log.entity_type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-mono text-[var(--text-secondary)]">
                    {log.agent_name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{log.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Expanded context */}
      {expandedId !== null && (() => {
        const log = logs.find((l) => l.id === expandedId);
        return log?.context ? (
          <div className="p-3 bg-[var(--surface-elevated)] rounded-book border border-[var(--border-default)] text-xs font-mono overflow-x-auto">
            <pre className="text-[var(--text-secondary)]">{JSON.stringify(log.context, null, 2)}</pre>
          </div>
        ) : null;
      })()}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
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
        </div>
      )}
    </div>
  );
}
