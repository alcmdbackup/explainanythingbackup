'use client';
/**
 * Admin reports table for reviewing user-submitted content reports.
 * Shows pending reports with actions to resolve them.
 */

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import {
  getContentReportsAction,
  resolveContentReportAction,
  type ContentReportWithExplanation,
  type ReportStatus
} from '@/lib/services/contentReports';

interface ReportsTableProps {
  initialStatus?: ReportStatus;
}

const REASON_LABELS: Record<string, string> = {
  inappropriate: 'Inappropriate Content',
  misinformation: 'Misinformation',
  spam: 'Spam',
  copyright: 'Copyright Violation',
  other: 'Other'
};

const STATUS_STYLES: Record<ReportStatus, string> = {
  pending: 'bg-[var(--status-warning)] text-[var(--text-primary)]',
  reviewed: 'bg-blue-600 text-white',
  dismissed: 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]',
  actioned: 'bg-[var(--status-error)] text-white'
};

export function ReportsTable({ initialStatus = 'pending' }: ReportsTableProps) {
  const [reports, setReports] = useState<ContentReportWithExplanation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const [statusFilter, setStatusFilter] = useState<ReportStatus | ''>(initialStatus);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [selectedReport, setSelectedReport] = useState<ContentReportWithExplanation | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await getContentReportsAction({
      status: statusFilter || undefined,
      limit: pageSize,
      offset: page * pageSize
    });

    if (result.success && result.data) {
      setReports(result.data.reports);
      setTotal(result.data.total);
    } else {
      setError(result.error?.message || 'Failed to load reports');
    }

    setLoading(false);
  }, [statusFilter, page]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleResolve = async (
    reportId: number,
    status: 'reviewed' | 'dismissed' | 'actioned',
    hideExplanation: boolean = false
  ) => {
    setActionLoading(reportId);
    setError(null);

    const result = await resolveContentReportAction({
      report_id: reportId,
      status,
      hide_explanation: hideExplanation
    });

    if (result.success) {
      const statusLabel = status === 'actioned' ? 'hidden' : status;
      toast.success(`Report ${statusLabel} successfully`);
      await loadReports();
      setSelectedReport(null);
    } else {
      setError(result.error?.message || 'Failed to resolve report');
    }

    setActionLoading(null);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4 items-center">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value as ReportStatus | ''); setPage(0); }}
          data-testid="admin-reports-status-filter"
          className="px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--surface-secondary)] text-[var(--text-primary)]"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="reviewed">Reviewed</option>
          <option value="dismissed">Dismissed</option>
          <option value="actioned">Actioned</option>
        </select>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 bg-red-900/20 border border-red-600 rounded-md text-red-400">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border border-[var(--border-default)] rounded-lg" data-testid="admin-reports-table">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="p-3 text-left">ID</th>
              <th className="p-3 text-left">Explanation</th>
              <th className="p-3 text-left">Reason</th>
              <th className="p-3 text-left">Details</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Reported</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[var(--text-muted)]">
                  Loading...
                </td>
              </tr>
            ) : reports.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[var(--text-muted)]">
                  No reports found
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr
                  key={report.id}
                  data-testid={`admin-reports-row-${report.id}`}
                  className="border-t border-[var(--border-default)] hover:bg-[var(--surface-secondary)]"
                >
                  <td className="p-3 text-[var(--text-muted)]">{report.id}</td>
                  <td className="p-3">
                    <a
                      href={`/explanations?id=${report.explanation_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`admin-reports-explanation-${report.id}`}
                      className="text-[var(--accent-gold)] hover:underline"
                    >
                      {report.explanation_title || `#${report.explanation_id}`}
                    </a>
                  </td>
                  <td className="p-3">
                    <span className="font-medium">{REASON_LABELS[report.reason] || report.reason}</span>
                  </td>
                  <td className="p-3 max-w-xs">
                    {report.details ? (
                      <span className="text-[var(--text-secondary)] text-sm">
                        {report.details.length > 50
                          ? `${report.details.slice(0, 50)}...`
                          : report.details}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)] text-sm italic">None</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-1 rounded text-xs ${STATUS_STYLES[report.status]}`}
                      data-testid={`admin-reports-status-badge-${report.id}`}
                    >
                      {report.status}
                    </span>
                  </td>
                  <td className="p-3 text-[var(--text-muted)]">
                    {new Date(report.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => setSelectedReport(report)}
                        data-testid={`admin-reports-view-${report.id}`}
                        className="text-[var(--accent-gold)] hover:underline text-xs"
                      >
                        View
                      </button>
                      {report.status === 'pending' ? (
                        <>
                          <button
                            onClick={() => handleResolve(report.id, 'dismissed')}
                            disabled={actionLoading === report.id}
                            data-testid={`admin-reports-dismiss-${report.id}`}
                            className="text-gray-400 hover:underline text-xs disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => handleResolve(report.id, 'reviewed')}
                            disabled={actionLoading === report.id}
                            data-testid={`admin-reports-review-${report.id}`}
                            className="text-blue-400 hover:underline text-xs disabled:opacity-50"
                          >
                            Mark Reviewed
                          </button>
                          <button
                            onClick={() => handleResolve(report.id, 'actioned', true)}
                            disabled={actionLoading === report.id}
                            data-testid={`admin-reports-action-${report.id}`}
                            className="text-red-400 hover:underline text-xs disabled:opacity-50"
                          >
                            Hide Content
                          </button>
                        </>
                      ) : (
                        <span className="text-[var(--text-muted)] text-xs">
                          {report.reviewed_at && `Resolved ${new Date(report.reviewed_at).toLocaleDateString()}`}
                        </span>
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
      <div className="flex justify-between items-center text-sm" data-testid="admin-reports-pagination">
        <span className="text-[var(--text-muted)]">
          {total > 0 ? `Showing ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)} of ${total}` : 'No reports'}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            data-testid="admin-reports-prev-page"
            className="px-3 py-1 border border-[var(--border-default)] rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-3 py-1">
            Page {page + 1} of {totalPages || 1}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            data-testid="admin-reports-next-page"
            className="px-3 py-1 border border-[var(--border-default)] rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {/* Report Details Modal */}
      {selectedReport && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          data-testid="admin-reports-detail-modal"
        >
          <div className="bg-[var(--surface-secondary)] rounded-lg shadow-warm-xl max-w-lg w-full">
            <div className="flex justify-between items-center p-4 border-b border-[var(--border-default)]">
              <h3 className="font-semibold text-[var(--text-primary)]">Report Details</h3>
              <button
                onClick={() => setSelectedReport(null)}
                data-testid="admin-reports-modal-close"
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl"
              >
                &times;
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <span className="text-[var(--text-muted)] text-sm">Explanation:</span>
                <p className="text-[var(--text-primary)]">{selectedReport.explanation_title}</p>
              </div>
              <div>
                <span className="text-[var(--text-muted)] text-sm">Reason:</span>
                <p className="text-[var(--text-primary)]">{REASON_LABELS[selectedReport.reason] || selectedReport.reason}</p>
              </div>
              <div>
                <span className="text-[var(--text-muted)] text-sm">Details:</span>
                <p className="text-[var(--text-primary)] whitespace-pre-wrap">
                  {selectedReport.details || 'No additional details provided'}
                </p>
              </div>
              {selectedReport.review_notes && (
                <div>
                  <span className="text-[var(--text-muted)] text-sm">Review Notes:</span>
                  <p className="text-[var(--text-primary)]">{selectedReport.review_notes}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-[var(--border-default)]">
              <button
                onClick={() => setSelectedReport(null)}
                data-testid="admin-reports-modal-close-footer"
                className="px-4 py-2 border border-[var(--border-default)] rounded-md hover:bg-[var(--surface-secondary)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
