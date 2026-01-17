'use client';
/**
 * Admin users page.
 * Shows user list with stats and management actions.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getAdminUsersAction,
  type UserWithStats
} from '@/lib/services/userAdmin';
import { UserDetailModal } from '@/components/admin/UserDetailModal';
import { formatCost } from '@/config/llmPricing';

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState('');
  const [showDisabled, setShowDisabled] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const [selectedUser, setSelectedUser] = useState<UserWithStats | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await getAdminUsersAction({
      search: search.trim() || undefined,
      showDisabled,
      limit: pageSize,
      offset: page * pageSize
    });

    if (result.success && result.data) {
      setUsers(result.data.users);
      setTotal(result.data.total);
    } else {
      setError(result.error?.message || 'Failed to load users');
    }

    setLoading(false);
  }, [search, showDisabled, page]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    loadUsers();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          User Management
        </h1>
        <p className="text-[var(--text-muted)] text-sm mt-1">
          View and manage user accounts
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center flex-wrap">
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email or ID..."
            className="px-3 py-2 border border-[var(--border-color)] rounded-md bg-[var(--bg-secondary)] text-[var(--text-primary)] w-64"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-[var(--accent-primary)] text-white rounded-md hover:opacity-90"
          >
            Search
          </button>
        </form>

        <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={showDisabled}
            onChange={(e) => { setShowDisabled(e.target.checked); setPage(0); }}
            className="rounded"
          />
          Show disabled
        </label>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 bg-red-900/20 border border-red-600 rounded-md text-red-400">
          {error}
        </div>
      )}

      {/* Users Table */}
      <div className="overflow-x-auto border border-[var(--border-color)] rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-[var(--bg-tertiary)]">
            <tr>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Explanations</th>
              <th className="p-3 text-right">LLM Calls</th>
              <th className="p-3 text-right">Total Cost</th>
              <th className="p-3 text-left">Created</th>
              <th className="p-3 text-left">Last Sign In</th>
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
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-[var(--text-muted)]">
                  No users found
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className="border-t border-[var(--border-color)] hover:bg-[var(--bg-secondary)]"
                >
                  <td className="p-3">
                    <div className="font-medium text-[var(--text-primary)]">{user.email}</div>
                    <div className="text-xs text-[var(--text-muted)] font-mono">{user.id.slice(0, 8)}...</div>
                  </td>
                  <td className="p-3">
                    {user.profile?.is_disabled ? (
                      <span className="px-2 py-1 rounded text-xs bg-red-900/30 text-red-400">
                        Disabled
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded text-xs bg-green-900/30 text-green-400">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right text-[var(--text-primary)]">
                    {user.stats.explanationCount}
                  </td>
                  <td className="p-3 text-right text-[var(--text-primary)]">
                    {user.stats.llmCallCount}
                  </td>
                  <td className="p-3 text-right text-[var(--text-primary)]">
                    {formatCost(user.stats.totalCost)}
                  </td>
                  <td className="p-3 text-[var(--text-muted)]">
                    {formatDate(user.created_at)}
                  </td>
                  <td className="p-3 text-[var(--text-muted)]">
                    {formatDate(user.last_sign_in_at)}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => setSelectedUser(user)}
                      className="text-[var(--accent-primary)] hover:underline text-xs"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center text-sm">
        <span className="text-[var(--text-muted)]">
          {total > 0 ? `Showing ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)} of ${total}` : 'No users'}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
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
            className="px-3 py-1 border border-[var(--border-color)] rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* User Detail Modal */}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onUpdate={() => {
            loadUsers();
            setSelectedUser(null);
          }}
        />
      )}
    </div>
  );
}
