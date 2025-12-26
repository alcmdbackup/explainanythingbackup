'use client';

import { type SourceChipType } from '@/lib/schemas/schemas';

interface FailedSourcesModalProps {
  isOpen: boolean;
  failedSources: SourceChipType[];
  onConfirm: (action: 'remove' | 'proceed') => void;
  onCancel: () => void;
}

/**
 * FailedSourcesModal - Shown when user submits with failed sources
 *
 * Options:
 * - "Remove failed" - Removes failed sources and proceeds
 * - "Proceed anyway" - Continues without the failed sources
 * - "Cancel" - Returns to editing
 */
export default function FailedSourcesModal({
  isOpen,
  failedSources,
  onConfirm,
  onCancel
}: FailedSourcesModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book shadow-warm-lg w-full max-w-md mx-4 animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--status-warning)]/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-[var(--status-warning)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-display font-semibold text-[var(--text-primary)]">
                Some Sources Failed to Load
              </h2>
              <p className="text-sm text-[var(--text-muted)]">
                {failedSources.length} source{failedSources.length === 1 ? '' : 's'} could not be fetched
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            The following sources could not be loaded and won&apos;t be included in the explanation:
          </p>

          {/* Failed sources list */}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {failedSources.map((source, index) => (
              <div
                key={`${source.url}-${index}`}
                className="flex items-start gap-3 p-3 bg-[var(--surface-secondary)] border border-[var(--status-error)]/20 rounded-page"
              >
                <svg className="w-4 h-4 text-[var(--status-error)] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-ui text-[var(--text-primary)] truncate">
                    {source.domain}
                  </p>
                  <p className="text-xs text-[var(--status-error)] mt-0.5">
                    {source.error_message || 'Failed to fetch'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-[var(--border-default)] flex flex-col sm:flex-row gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 text-sm font-ui font-medium text-[var(--text-secondary)] bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-page transition-all duration-200 hover:border-[var(--accent-copper)] hover:text-[var(--accent-copper)]"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm('remove')}
            className="flex-1 px-4 py-2 text-sm font-ui font-medium text-[var(--text-on-primary)] bg-gradient-to-br from-[var(--accent-gold)] to-[var(--accent-copper)] rounded-page transition-all duration-200 hover:shadow-warm-md"
          >
            Remove Failed & Continue
          </button>
        </div>

        {/* Close button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
