'use client';
/**
 * Report content button with modal for users to report problematic content.
 * Shows a flag icon button that opens a report form modal.
 */

import { useState } from 'react';
import { createContentReportAction, type ReportReason } from '@/lib/services/contentReports';

interface ReportContentButtonProps {
  explanationId: number;
  disabled?: boolean;
}

const REPORT_REASONS: { value: ReportReason; label: string; description: string }[] = [
  { value: 'inappropriate', label: 'Inappropriate Content', description: 'Contains offensive or harmful material' },
  { value: 'misinformation', label: 'Misinformation', description: 'Contains false or misleading information' },
  { value: 'spam', label: 'Spam', description: 'Promotional content or spam' },
  { value: 'copyright', label: 'Copyright Violation', description: 'Violates copyright or intellectual property' },
  { value: 'other', label: 'Other', description: 'Other issue not listed above' }
];

export function ReportContentButton({ explanationId, disabled }: ReportContentButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!reason) {
      setError('Please select a reason');
      return;
    }

    setLoading(true);
    setError(null);

    const result = await createContentReportAction({
      explanation_id: explanationId,
      reason,
      details: details.trim() || undefined
    });

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        setIsOpen(false);
        setSuccess(false);
        setReason('');
        setDetails('');
      }, 2000);
    } else {
      setError(result.error?.message || 'Failed to submit report');
    }

    setLoading(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setError(null);
    setSuccess(false);
    setReason('');
    setDetails('');
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        title="Report this content"
        className="inline-flex items-center justify-center rounded-page bg-[var(--surface-secondary)] border border-[var(--border-default)] px-3 py-2 text-sm font-ui font-medium text-[var(--text-muted)] shadow-warm transition-all duration-200 hover:border-[var(--accent-gold)] hover:text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-50 h-9"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4"
        >
          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <line x1="4" y1="22" x2="4" y2="15" />
        </svg>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--bg-primary)] rounded-lg shadow-warm-xl max-w-md w-full">
            <div className="flex justify-between items-center p-4 border-b border-[var(--border-color)]">
              <h3 className="font-semibold text-[var(--text-primary)]">Report Content</h3>
              <button
                onClick={handleClose}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl"
              >
                &times;
              </button>
            </div>

            <div className="p-4 space-y-4">
              {success ? (
                <div className="p-4 bg-green-900/20 border border-green-600 rounded-md text-green-400 text-center">
                  Thank you for your report. We will review it shortly.
                </div>
              ) : (
                <>
                  {error && (
                    <div className="p-3 bg-red-900/20 border border-red-600 rounded-md text-red-400 text-sm">
                      {error}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                      Why are you reporting this content?
                    </label>
                    <div className="space-y-2">
                      {REPORT_REASONS.map((r) => (
                        <label
                          key={r.value}
                          className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                            reason === r.value
                              ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                              : 'border-[var(--border-color)] hover:border-[var(--border-hover)]'
                          }`}
                        >
                          <input
                            type="radio"
                            name="reason"
                            value={r.value}
                            checked={reason === r.value}
                            onChange={(e) => setReason(e.target.value as ReportReason)}
                            className="mt-0.5"
                          />
                          <div>
                            <div className="font-medium text-[var(--text-primary)]">{r.label}</div>
                            <div className="text-xs text-[var(--text-muted)]">{r.description}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                      Additional details (optional)
                    </label>
                    <textarea
                      value={details}
                      onChange={(e) => setDetails(e.target.value)}
                      placeholder="Provide any additional context that might help us review this report..."
                      className="w-full px-3 py-2 border border-[var(--border-color)] rounded-md bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm resize-none"
                      rows={3}
                    />
                  </div>
                </>
              )}
            </div>

            {!success && (
              <div className="flex justify-end gap-2 p-4 border-t border-[var(--border-color)]">
                <button
                  onClick={handleClose}
                  className="px-4 py-2 border border-[var(--border-color)] rounded-md hover:bg-[var(--bg-secondary)] text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || !reason}
                  className="px-4 py-2 bg-[var(--accent-primary)] text-white rounded-md hover:opacity-90 disabled:opacity-50 text-sm"
                >
                  {loading ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
