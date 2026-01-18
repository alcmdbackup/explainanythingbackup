'use client';
/**
 * Modal for viewing and managing a single explanation in the admin dashboard.
 * Shows full content and provides hide/restore actions.
 */

import { useState } from 'react';
import {
  hideExplanationAction,
  restoreExplanationAction,
  type AdminExplanation
} from '@/lib/services/adminContent';

interface ExplanationDetailModalProps {
  explanation: AdminExplanation;
  onClose: () => void;
  onUpdate: () => void;
}

export function ExplanationDetailModal({
  explanation,
  onClose,
  onUpdate
}: ExplanationDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleHide = async () => {
    setLoading(true);
    setError(null);
    const result = await hideExplanationAction(explanation.id);
    if (result.success) {
      onUpdate();
      onClose();
    } else {
      setError(result.error?.message || 'Failed to hide explanation');
    }
    setLoading(false);
  };

  const handleRestore = async () => {
    setLoading(true);
    setError(null);
    const result = await restoreExplanationAction(explanation.id);
    if (result.success) {
      onUpdate();
      onClose();
    } else {
      setError(result.error?.message || 'Failed to restore explanation');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-primary)] rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start p-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">
              {explanation.explanation_title || 'Untitled'}
            </h2>
            <div className="flex gap-3 mt-1 text-sm text-[var(--text-muted)]">
              <span>ID: {explanation.id}</span>
              <span>Status: {explanation.status}</span>
              {explanation.delete_status !== 'visible' && (
                <span className="text-red-400">{explanation.delete_status}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-900/20 border border-red-600 rounded-md text-red-400">
              {error}
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <span className="text-[var(--text-muted)]">Created:</span>{' '}
              <span className="text-[var(--text-primary)]">
                {new Date(explanation.timestamp).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-[var(--text-muted)]">Primary Topic ID:</span>{' '}
              <span className="text-[var(--text-primary)]">
                {explanation.primary_topic_id || 'None'}
              </span>
            </div>
            {explanation.delete_status !== 'visible' && explanation.delete_status_changed_at && (
              <>
                <div>
                  <span className="text-[var(--text-muted)]">Status Changed:</span>{' '}
                  <span className="text-red-400">
                    {new Date(explanation.delete_status_changed_at).toLocaleString()}
                  </span>
                </div>
                {explanation.delete_reason && (
                  <div>
                    <span className="text-[var(--text-muted)]">Reason:</span>{' '}
                    <span className="text-[var(--text-primary)]">
                      {explanation.delete_reason}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Summary */}
          {explanation.summary_teaser && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-1">Summary</h3>
              <p className="text-[var(--text-secondary)] text-sm">
                {explanation.summary_teaser}
              </p>
            </div>
          )}

          {/* Content preview */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-muted)] mb-2">Content</h3>
            <div className="bg-[var(--bg-secondary)] rounded-lg p-4 max-h-96 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-[var(--text-primary)] font-mono">
                {explanation.content}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-[var(--border-color)]">
          <a
            href={`/explanations?id=${explanation.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-primary)] hover:underline text-sm"
          >
            View Public Page →
          </a>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-secondary)]"
            >
              Close
            </button>
            {explanation.delete_status !== 'visible' ? (
              <button
                onClick={handleRestore}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {loading ? 'Restoring...' : 'Restore'}
              </button>
            ) : (
              <button
                onClick={handleHide}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {loading ? 'Hiding...' : 'Hide'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
