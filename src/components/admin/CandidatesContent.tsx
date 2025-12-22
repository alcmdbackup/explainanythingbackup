'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getAllCandidatesAction,
  approveCandidateAction,
  rejectCandidateAction,
  deleteCandidateAction
} from '@/actions/actions';
import { CandidateStatus, type LinkCandidateFullType } from '@/lib/schemas/schemas';

type FilterStatus = 'all' | CandidateStatus;
type ModalMode = 'approve' | null;

export default function CandidatesContent() {
  const [candidates, setCandidates] = useState<LinkCandidateFullType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<FilterStatus>(CandidateStatus.Pending);

  // Modal state
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<LinkCandidateFullType | null>(null);
  const [standaloneTitle, setStandaloneTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);
    const status = filterStatus === 'all' ? undefined : filterStatus as CandidateStatus;
    const result = await getAllCandidatesAction(status);
    if (result.success && result.data) {
      setCandidates(result.data);
    } else {
      setError(result.error?.message || 'Failed to load candidates');
    }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  const openApproveModal = (candidate: LinkCandidateFullType) => {
    setSelectedCandidate(candidate);
    // Pre-fill with "What is {term}?" format
    setStandaloneTitle(`What is ${candidate.term}?`);
    setModalMode('approve');
  };

  const closeModal = () => {
    setModalMode(null);
    setSelectedCandidate(null);
    setStandaloneTitle('');
  };

  const handleApprove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCandidate || !standaloneTitle.trim()) return;

    setSaving(true);
    const result = await approveCandidateAction(selectedCandidate.id, standaloneTitle.trim());
    if (result.success) {
      await loadCandidates();
      closeModal();
    } else {
      setError(result.error?.message || 'Failed to approve candidate');
    }
    setSaving(false);
  };

  const handleReject = async (id: number) => {
    const result = await rejectCandidateAction(id);
    if (result.success) {
      await loadCandidates();
    } else {
      setError(result.error?.message || 'Failed to reject candidate');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to permanently delete this candidate?')) {
      return;
    }

    const result = await deleteCandidateAction(id);
    if (result.success) {
      await loadCandidates();
    } else {
      setError(result.error?.message || 'Failed to delete candidate');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-400';
      case 'approved':
        return 'bg-green-500/20 text-green-400';
      case 'rejected':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-gray-500/20 text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="scholar-card p-6">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-[var(--surface-elevated)] rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <p className="text-[var(--text-secondary)]">
            {candidates.length} candidate{candidates.length !== 1 ? 's' : ''}
          </p>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            className="px-3 py-1.5 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold)]"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="scholar-card overflow-hidden">
        <table className="w-full">
          <thead className="bg-[var(--surface-elevated)]">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Term</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Source</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Occurrences</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Articles</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">First Seen</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-[var(--text-secondary)]">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-default)]">
            {candidates.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[var(--text-muted)]">
                  No candidates found.
                </td>
              </tr>
            ) : (
              candidates.map((candidate) => (
                <tr key={candidate.id} className="hover:bg-[var(--surface-secondary)]">
                  <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{candidate.term}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-sm">{candidate.source}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{candidate.total_occurrences}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]">{candidate.article_count}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded capitalize ${getStatusBadge(candidate.status)}`}>
                      {candidate.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-secondary)] text-sm">
                    {formatDate(candidate.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {candidate.status === 'pending' && (
                      <>
                        <button
                          onClick={() => openApproveModal(candidate)}
                          className="px-3 py-1 text-sm text-green-400 hover:text-green-300"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleReject(candidate.id)}
                          className="px-3 py-1 text-sm text-yellow-400 hover:text-yellow-300"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleDelete(candidate.id)}
                      className="px-3 py-1 text-sm text-red-400 hover:text-red-300"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Approve Modal */}
      {modalMode === 'approve' && selectedCandidate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--surface-primary)] rounded-lg shadow-xl max-w-lg w-full mx-4">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-display text-[var(--text-primary)]">
                  Approve &quot;{selectedCandidate.term}&quot;
                </h2>
                <button
                  onClick={closeModal}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  &times;
                </button>
              </div>

              <form onSubmit={handleApprove} className="space-y-4">
                <div>
                  <label className="block text-sm text-[var(--text-secondary)] mb-1">
                    Standalone Title *
                  </label>
                  <input
                    type="text"
                    value={standaloneTitle}
                    onChange={(e) => setStandaloneTitle(e.target.value)}
                    placeholder="e.g., What is Machine Learning?"
                    className="w-full px-3 py-2 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold)]"
                    required
                  />
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    This title will be used for the whitelist entry
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !standaloneTitle.trim()}
                    className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Approving...' : 'Approve & Add to Whitelist'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
