'use client';
/**
 * Admin Audit Log page.
 * Displays audit trail of all admin actions with filtering and export.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getAuditLogsAction,
  getAuditAdminsAction,
  exportAuditLogsAction,
  type AuditLogEntry,
  type AuditAction,
  type EntityType,
  type AuditLogFilters
} from '@/lib/services/auditLog';

const ACTIONS: { value: AuditAction; label: string }[] = [
  { value: 'hide_explanation', label: 'Hide Explanation' },
  { value: 'restore_explanation', label: 'Restore Explanation' },
  { value: 'bulk_hide_explanations', label: 'Bulk Hide' },
  { value: 'resolve_report', label: 'Resolve Report' },
  { value: 'disable_user', label: 'Disable User' },
  { value: 'enable_user', label: 'Enable User' },
  { value: 'update_user_notes', label: 'Update Notes' },
  { value: 'update_feature_flag', label: 'Update Flag' },
  { value: 'backfill_costs', label: 'Backfill Costs' }
];

const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: 'explanation', label: 'Explanation' },
  { value: 'report', label: 'Report' },
  { value: 'user', label: 'User' },
  { value: 'feature_flag', label: 'Feature Flag' },
  { value: 'system', label: 'System' }
];

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [admins, setAdmins] = useState<{ adminId: string; count: number }[]>([]);

  // Filters
  const [selectedAdmin, setSelectedAdmin] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [selectedEntityType, setSelectedEntityType] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const filters: AuditLogFilters = {
        limit: pageSize,
        offset: (page - 1) * pageSize
      };

      if (selectedAdmin) filters.adminUserId = selectedAdmin;
      if (selectedAction) filters.action = selectedAction as AuditAction;
      if (selectedEntityType) filters.entityType = selectedEntityType as EntityType;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const result = await getAuditLogsAction(filters);
      if (result.success && result.data) {
        setLogs(result.data.logs);
        setTotal(result.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, selectedAdmin, selectedAction, selectedEntityType, startDate, endDate]);

  const loadAdmins = useCallback(async () => {
    const result = await getAuditAdminsAction();
    if (result.success && result.data) {
      setAdmins(result.data);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const filters: AuditLogFilters = {};
      if (selectedAdmin) filters.adminUserId = selectedAdmin;
      if (selectedAction) filters.action = selectedAction as AuditAction;
      if (selectedEntityType) filters.entityType = selectedEntityType as EntityType;
      if (startDate) filters.startDate = startDate;
      if (endDate) filters.endDate = endDate;

      const result = await exportAuditLogsAction(filters);
      if (result.success && result.data) {
        // Convert to CSV
        const headers = ['ID', 'Admin User ID', 'Action', 'Entity Type', 'Entity ID', 'Details', 'IP Address', 'User Agent', 'Created At'];
        const rows = result.data.map(log => [
          log.id,
          log.admin_user_id,
          log.action,
          log.entity_type,
          log.entity_id,
          JSON.stringify(log.details || {}),
          log.ip_address || '',
          log.user_agent || '',
          log.created_at
        ]);

        const csv = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleClearFilters = () => {
    setSelectedAdmin('');
    setSelectedAction('');
    setSelectedEntityType('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getActionBadgeColor = (action: string) => {
    if (action.includes('hide') || action.includes('disable')) {
      return 'bg-red-100 text-red-800';
    }
    if (action.includes('restore') || action.includes('enable')) {
      return 'bg-green-100 text-green-800';
    }
    if (action.includes('resolve')) {
      return 'bg-blue-100 text-blue-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  return (
    <div>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Audit Log</h1>
            <p className="text-[var(--text-secondary)]">
              Track all admin actions for accountability and compliance
            </p>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting || logs.length === 0}
            className="px-4 py-2 bg-[var(--accent-primary)] text-white rounded hover:opacity-90 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 mb-6 border border-[var(--border-color)]">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Admin
              </label>
              <select
                value={selectedAdmin}
                onChange={(e) => { setSelectedAdmin(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
              >
                <option value="">All Admins</option>
                {admins.map((admin) => (
                  <option key={admin.adminId} value={admin.adminId}>
                    {admin.adminId.slice(0, 8)}... ({admin.count})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Action
              </label>
              <select
                value={selectedAction}
                onChange={(e) => { setSelectedAction(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
              >
                <option value="">All Actions</option>
                {ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>{action.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Entity Type
              </label>
              <select
                value={selectedEntityType}
                onChange={(e) => { setSelectedEntityType(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
              >
                <option value="">All Types</option>
                {ENTITY_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                className="w-full px-3 py-2 rounded border border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={handleClearFilters}
                className="w-full px-3 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] rounded"
              >
                Clear Filters
              </button>
            </div>
          </div>
        </div>

        {/* Results count */}
        <div className="text-sm text-[var(--text-muted)] mb-4">
          Showing {logs.length} of {total} entries
        </div>

        {/* Logs Table */}
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-[var(--text-muted)]">Loading...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-muted)]">No audit logs found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--bg-tertiary)]">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">
                      Admin
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">
                      Action
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">
                      Entity
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">
                      Details
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">
                      IP
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-[var(--bg-tertiary)]">
                      <td className="px-4 py-3 text-sm text-[var(--text-primary)] whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-secondary)] font-mono">
                        {log.admin_user_id.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded ${getActionBadgeColor(log.action)}`}>
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="text-[var(--text-secondary)]">{log.entity_type}:</span>{' '}
                        <span className="text-[var(--text-primary)] font-mono">
                          {log.entity_id.length > 20 ? `${log.entity_id.slice(0, 20)}...` : log.entity_id}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-muted)] max-w-xs truncate">
                        {log.details ? JSON.stringify(log.details) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-muted)] font-mono">
                        {log.ip_address || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center items-center gap-2 mt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded border border-[var(--border-color)] disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-[var(--text-secondary)]">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded border border-[var(--border-color)] disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
    </div>
  );
}
