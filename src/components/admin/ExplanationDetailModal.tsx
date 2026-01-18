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
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-start p-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {explanation.explanation_title || 'Untitled'}
            </h2>
            <div className="flex gap-3 mt-1 text-sm text-gray-500">
              <span>ID: {explanation.id}</span>
              <span>Status: {explanation.status}</span>
              {explanation.delete_status !== 'visible' && (
                <span className="text-red-600">{explanation.delete_status}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-md text-red-700">
              {error}
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
            <div>
              <span className="text-gray-500">Created:</span>{' '}
              <span className="text-gray-900">
                {new Date(explanation.timestamp).toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Primary Topic ID:</span>{' '}
              <span className="text-gray-900">
                {explanation.primary_topic_id || 'None'}
              </span>
            </div>
            {explanation.delete_status !== 'visible' && explanation.delete_status_changed_at && (
              <>
                <div>
                  <span className="text-gray-500">Status Changed:</span>{' '}
                  <span className="text-red-600">
                    {new Date(explanation.delete_status_changed_at).toLocaleString()}
                  </span>
                </div>
                {explanation.delete_reason && (
                  <div>
                    <span className="text-gray-500">Reason:</span>{' '}
                    <span className="text-gray-900">
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
              <h3 className="text-sm font-semibold text-gray-500 mb-1">Summary</h3>
              <p className="text-gray-700 text-sm">
                {explanation.summary_teaser}
              </p>
            </div>
          )}

          {/* Content preview */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 mb-2">Content</h3>
            <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto border border-gray-200">
              <pre className="whitespace-pre-wrap text-sm text-gray-900 font-mono">
                {explanation.content}
              </pre>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-4 border-t border-gray-200">
          <a
            href={`/explanations?id=${explanation.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline text-sm"
          >
            View Public Page →
          </a>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-100 text-gray-700"
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
