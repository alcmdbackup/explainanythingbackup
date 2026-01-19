'use client';
/**
 * Admin explanation table with sorting, filtering, and bulk operations.
 * Displays explanations in a data table format with selection capabilities.
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getAdminExplanationsAction,
  hideExplanationAction,
  restoreExplanationAction,
  bulkHideExplanationsAction,
  type AdminExplanation,
  type AdminExplanationFilters
} from '@/lib/services/adminContent';

interface ExplanationTableProps {
  onSelectExplanation?: (explanation: AdminExplanation) => void;
}

type SortField = 'timestamp' | 'title' | 'id';
type SortOrder = 'asc' | 'desc';

export function ExplanationTable({ onSelectExplanation }: ExplanationTableProps) {
  const [explanations, setExplanations] = useState<AdminExplanation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showHidden, setShowHidden] = useState(true);
  const [filterTestContent, setFilterTestContent] = useState(true);

  // Sorting
  const [sortBy, setSortBy] = useState<SortField>('timestamp');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Pagination
  const [page, setPage] = useState(0);
  const pageSize = 25;

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Action states
  const [actionLoading, setActionLoading] = useState(false);

  const loadExplanations = useCallback(async () => {
    setLoading(true);
    setError(null);

    const filters: AdminExplanationFilters = {
      search: search || undefined,
      status: statusFilter || undefined,
      showHidden,
      filterTestContent,
      limit: pageSize,
      offset: page * pageSize,
      sortBy,
      sortOrder
    };

    const result = await getAdminExplanationsAction(filters);

    if (result.success && result.data) {
      setExplanations(result.data.explanations);
      setTotal(result.data.total);
    } else {
      setError(result.error?.message || 'Failed to load explanations');
    }

    setLoading(false);
  }, [search, statusFilter, showHidden, filterTestContent, page, sortBy, sortOrder]);

  useEffect(() => {
    loadExplanations();
  }, [loadExplanations]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    setPage(0);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === explanations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(explanations.map(e => e.id)));
    }
  };

  const handleSelectOne = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleHide = async (id: number) => {
    setActionLoading(true);
    const result = await hideExplanationAction(id);
    if (result.success) {
      toast.success('Explanation hidden successfully');
      await loadExplanations();
    } else {
      setError(result.error?.message || 'Failed to hide explanation');
    }
    setActionLoading(false);
  };

  const handleRestore = async (id: number) => {
    setActionLoading(true);
    const result = await restoreExplanationAction(id);
    if (result.success) {
      toast.success('Explanation restored successfully');
      await loadExplanations();
    } else {
      setError(result.error?.message || 'Failed to restore explanation');
    }
    setActionLoading(false);
  };

  const handleBulkHide = async () => {
    if (selectedIds.size === 0) return;

    setActionLoading(true);
    const result = await bulkHideExplanationsAction(Array.from(selectedIds));
    if (result.success) {
      toast.success(`${selectedIds.size} explanations hidden successfully`);
      setSelectedIds(new Set());
      await loadExplanations();
    } else {
      setError(result.error?.message || 'Failed to bulk hide explanations');
    }
    setActionLoading(false);
  };

  const totalPages = Math.ceil(total / pageSize);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return <span className="text-[var(--text-muted)]">↕</span>;
    return <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center">
        <input
          type="text"
          placeholder="Search explanations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="admin-content-search"
          className="px-3 py-2 border border-[var(--border-color)] rounded-md bg-[var(--bg-secondary)] text-[var(--text-primary)] w-64"
        />

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          data-testid="admin-content-status-filter"
          className="px-3 py-2 border border-[var(--border-color)] rounded-md bg-[var(--bg-secondary)] text-[var(--text-primary)]"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => { setShowHidden(e.target.checked); setPage(0); }}
            data-testid="admin-content-show-hidden"
            className="rounded"
          />
          Show hidden
        </label>

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={filterTestContent}
            onChange={(e) => { setFilterTestContent(e.target.checked); setPage(0); }}
            className="rounded"
          />
          Filter test content
        </label>

        {selectedIds.size > 0 && (
          <button
            onClick={handleBulkHide}
            disabled={actionLoading}
            data-testid="admin-content-bulk-hide"
            className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            Hide Selected ({selectedIds.size})
          </button>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 bg-red-900/20 border border-red-600 rounded-md text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-[var(--border-color)] rounded-lg" data-testid="admin-content-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-tertiary)]">
            <tr>
              <th className="p-3 text-left">
                <input
                  type="checkbox"
                  checked={explanations.length > 0 && selectedIds.size === explanations.length}
                  onChange={handleSelectAll}
                  data-testid="admin-content-select-all"
                  className="rounded"
                />
              </th>
              <th
                className="p-3 text-left cursor-pointer hover:bg-[var(--bg-secondary)]"
                onClick={() => handleSort('id')}
              >
                ID <SortIcon field="id" />
              </th>
              <th
                className="p-3 text-left cursor-pointer hover:bg-[var(--bg-secondary)]"
                onClick={() => handleSort('title')}
              >
                Title <SortIcon field="title" />
              </th>
              <th className="p-3 text-left">Link</th>
              <th className="p-3 text-left">Status</th>
              <th
                className="p-3 text-left cursor-pointer hover:bg-[var(--bg-secondary)]"
                onClick={() => handleSort('timestamp')}
              >
                Created <SortIcon field="timestamp" />
              </th>
              <th className="p-3 text-left">Hidden</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-[var(--text-muted)]">
                  Loading...
                </td>
              </tr>
            ) : explanations.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-[var(--text-muted)]">
                  No explanations found
                </td>
              </tr>
            ) : (
              explanations.map((exp) => (
                <tr
                  key={exp.id}
                  data-testid={`admin-content-row-${exp.id}`}
                  className={`border-t border-[var(--border-color)] hover:bg-[var(--bg-secondary)] ${
                    exp.delete_status !== 'visible' ? 'opacity-60' : ''
                  }`}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(exp.id)}
                      onChange={() => handleSelectOne(exp.id)}
                      data-testid={`admin-content-checkbox-${exp.id}`}
                      className="rounded"
                    />
                  </td>
                  <td className="p-3 text-[var(--text-muted)]">{exp.id}</td>
                  <td className="p-3">
                    <button
                      onClick={() => onSelectExplanation?.(exp)}
                      data-testid={`admin-content-title-${exp.id}`}
                      className="text-left hover:text-[var(--accent-primary)] font-medium"
                    >
                      {exp.explanation_title || 'Untitled'}
                    </button>
                  </td>
                  <td className="p-3">
                    <a
                      href={`/explanations?id=${exp.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent-primary)] hover:underline inline-flex items-center"
                      title="Open explanation"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs ${
                      exp.status === 'published'
                        ? 'bg-green-800 text-green-100'
                        : 'bg-orange-800 text-orange-100'
                    }`}>
                      {exp.status}
                    </span>
                  </td>
                  <td className="p-3 text-[var(--text-muted)]">
                    {new Date(exp.timestamp).toLocaleDateString()}
                  </td>
                  <td className="p-3">
                    {exp.delete_status !== 'visible' ? (
                      <span className="text-red-400">{exp.delete_status}</span>
                    ) : (
                      <span className="text-[var(--text-muted)]">visible</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => onSelectExplanation?.(exp)}
                        data-testid={`admin-content-view-${exp.id}`}
                        className="text-[var(--accent-primary)] hover:underline text-xs"
                      >
                        View
                      </button>
                      {exp.delete_status !== 'visible' ? (
                        <button
                          onClick={() => handleRestore(exp.id)}
                          disabled={actionLoading}
                          data-testid={`admin-content-restore-${exp.id}`}
                          className="text-green-400 hover:underline text-xs disabled:opacity-50"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => handleHide(exp.id)}
                          disabled={actionLoading}
                          data-testid={`admin-content-hide-${exp.id}`}
                          className="text-red-400 hover:underline text-xs disabled:opacity-50"
                        >
                          Hide
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center text-sm" data-testid="admin-content-pagination">
        <span className="text-[var(--text-muted)]">
          Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            data-testid="admin-content-prev-page"
            className="px-3 py-1 border border-[var(--border-color)] rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1">
            Page {page + 1} of {totalPages || 1}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            data-testid="admin-content-next-page"
            className="px-3 py-1 border border-[var(--border-color)] rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
