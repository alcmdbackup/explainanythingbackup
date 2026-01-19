'use client';
/**
 * Admin user detail modal with accessibility support.
 * Shows user info, stats, and provides disable/enable actions.
 */

import { useState, useId } from 'react';
import FocusTrap from 'focus-trap-react';
import { toast } from 'sonner';
import {
  disableUserAction,
  enableUserAction,
  updateUserNotesAction,
  type UserWithStats
} from '@/lib/services/userAdmin';
import { formatCost } from '@/config/llmPricing';

interface UserDetailModalProps {
  user: UserWithStats;
  onClose: () => void;
  onUpdate: () => void;
}

export function UserDetailModal({ user, onClose, onUpdate }: UserDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(user.profile?.admin_notes || '');
  const [disableReason, setDisableReason] = useState('');
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const titleId = useId();

  const isDisabled = user.profile?.is_disabled || false;

  const handleDisable = async () => {
    setLoading(true);
    setError(null);

    const result = await disableUserAction({
      userId: user.id,
      reason: disableReason.trim() || undefined
    });

    if (result.success) {
      toast.success('User account disabled successfully');
      setShowDisableConfirm(false);
      onUpdate();
    } else {
      setError(result.error?.message || 'Failed to disable user');
    }

    setLoading(false);
  };

  const handleEnable = async () => {
    setLoading(true);
    setError(null);

    const result = await enableUserAction(user.id);

    if (result.success) {
      toast.success('User account enabled successfully');
      onUpdate();
    } else {
      setError(result.error?.message || 'Failed to enable user');
    }

    setLoading(false);
  };

  const handleSaveNotes = async () => {
    setLoading(true);
    setError(null);

    const result = await updateUserNotesAction({
      userId: user.id,
      notes: notes.trim()
    });

    if (result.success) {
      toast.success('Notes saved successfully');
      onUpdate();
    } else {
      setError(result.error?.message || 'Failed to save notes');
    }

    setLoading(false);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <FocusTrap>
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="admin-user-detail-modal"
      >
        <div className="bg-[var(--bg-primary)] rounded-lg shadow-warm-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="flex justify-between items-center p-4 border-b border-[var(--border-color)]">
            <div>
              <h3 id={titleId} className="font-semibold text-[var(--text-primary)]">User Details</h3>
              <p className="text-sm text-[var(--text-muted)]">{user.email}</p>
            </div>
            <button
              onClick={onClose}
              data-testid="admin-user-detail-close"
              aria-label="Close modal"
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl"
            >
              &times;
            </button>
          </div>

        <div className="p-4 space-y-6">
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-600 rounded-md text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Status Badge */}
          {isDisabled && (
            <div className="p-3 bg-red-900/20 border border-red-600 rounded-md">
              <div className="font-medium text-red-400">Account Disabled</div>
              {user.profile?.disabled_reason && (
                <div className="text-sm text-red-300 mt-1">
                  Reason: {user.profile.disabled_reason}
                </div>
              )}
              {user.profile?.disabled_at && (
                <div className="text-xs text-red-300/70 mt-1">
                  Disabled at: {formatDate(user.profile.disabled_at)}
                </div>
              )}
            </div>
          )}

          {/* User Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-[var(--text-muted)] uppercase">User ID</label>
              <p className="font-mono text-sm text-[var(--text-primary)] break-all">{user.id}</p>
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] uppercase">Email</label>
              <p className="text-sm text-[var(--text-primary)]">{user.email}</p>
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] uppercase">Created</label>
              <p className="text-sm text-[var(--text-primary)]">{formatDate(user.created_at)}</p>
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] uppercase">Last Sign In</label>
              <p className="text-sm text-[var(--text-primary)]">{formatDate(user.last_sign_in_at)}</p>
            </div>
          </div>

          {/* Stats */}
          <div>
            <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Usage Statistics</h4>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                <div className="text-2xl font-bold text-[var(--text-primary)]">
                  {user.stats.explanationCount}
                </div>
                <div className="text-xs text-[var(--text-muted)]">Explanations</div>
              </div>
              <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                <div className="text-2xl font-bold text-[var(--text-primary)]">
                  {user.stats.llmCallCount}
                </div>
                <div className="text-xs text-[var(--text-muted)]">LLM Calls</div>
              </div>
              <div className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                <div className="text-2xl font-bold text-[var(--accent-primary)]">
                  {formatCost(user.stats.totalCost)}
                </div>
                <div className="text-xs text-[var(--text-muted)]">Total Cost</div>
              </div>
            </div>
          </div>

          {/* Admin Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Admin Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes about this user..."
              data-testid="admin-user-detail-notes"
              className="w-full px-3 py-2 border border-[var(--border-color)] rounded-md bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm resize-none"
              rows={3}
            />
            {notes !== (user.profile?.admin_notes || '') && (
              <button
                onClick={handleSaveNotes}
                disabled={loading}
                data-testid="admin-user-detail-save-notes"
                className="mt-2 px-3 py-1 bg-[var(--accent-primary)] text-white rounded text-sm disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Notes'}
              </button>
            )}
          </div>

          {/* Disable/Enable Section */}
          <div className="border-t border-[var(--border-color)] pt-4">
            <h4 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Account Actions</h4>

            {!showDisableConfirm ? (
              <div className="flex gap-2">
                {isDisabled ? (
                  <button
                    onClick={handleEnable}
                    disabled={loading}
                    data-testid="admin-user-detail-enable"
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm"
                  >
                    {loading ? 'Enabling...' : 'Enable Account'}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowDisableConfirm(true)}
                    data-testid="admin-user-detail-disable"
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm"
                  >
                    Disable Account
                  </button>
                )}
              </div>
            ) : (
              <div className="p-3 bg-red-900/10 border border-red-600/50 rounded-md" data-testid="admin-user-detail-disable-confirm">
                <p className="text-sm text-[var(--text-primary)] mb-3">
                  Are you sure you want to disable this account? The user will not be able to access the application.
                </p>
                <div className="mb-3">
                  <label className="block text-xs text-[var(--text-muted)] mb-1">
                    Reason (optional, visible to user)
                  </label>
                  <input
                    type="text"
                    value={disableReason}
                    onChange={(e) => setDisableReason(e.target.value)}
                    placeholder="e.g., Terms of service violation"
                    data-testid="admin-user-detail-disable-reason"
                    className="w-full px-3 py-2 border border-[var(--border-color)] rounded-md bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleDisable}
                    disabled={loading}
                    data-testid="admin-user-detail-confirm-disable"
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 text-sm"
                  >
                    {loading ? 'Disabling...' : 'Confirm Disable'}
                  </button>
                  <button
                    onClick={() => setShowDisableConfirm(false)}
                    disabled={loading}
                    data-testid="admin-user-detail-cancel-disable"
                    className="px-4 py-2 border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-secondary)] text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t border-[var(--border-color)]">
          <button
            onClick={onClose}
            data-testid="admin-user-detail-close-footer"
            className="px-4 py-2 border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-secondary)]"
          >
            Close
          </button>
        </div>
      </div>
      </div>
    </FocusTrap>
  );
}
