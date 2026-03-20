// Reusable status badge for evolution run statuses.
'use client';

import React from 'react';

import type { EvolutionRunStatus } from '@evolution/lib/types';

const STATUS_STYLES: Record<EvolutionRunStatus, string> = {
  pending:
    'bg-[var(--status-warning)]/20 text-[var(--status-warning)] border-[var(--status-warning)]/30',
  claimed:
    'bg-[var(--text-muted)]/20 text-[var(--text-muted)] border-[var(--text-muted)]/30',
  running:
    'bg-[var(--accent-gold)]/20 text-[var(--accent-gold)] border-[var(--accent-gold)]/30',
  completed:
    'bg-[var(--status-success)]/20 text-[var(--status-success)] border-[var(--status-success)]/30',
  failed:
    'bg-[var(--status-error)]/20 text-[var(--status-error)] border-[var(--status-error)]/30',
  cancelled:
    'bg-[var(--status-error)]/20 text-[var(--status-error)] border-[var(--status-error)]/30',
};

const STATUS_ICONS: Record<EvolutionRunStatus, string> = {
  pending: '\u23F3',   // hourglass
  claimed: '\u25B6',   // play (starting)
  running: '\u25B6',   // play
  completed: '\u2713', // checkmark
  failed: '\u2717',    // X mark
  cancelled: '\u23F9', // stop button
};

interface EvolutionStatusBadgeProps {
  status: EvolutionRunStatus;
  hasError?: boolean;
  className?: string;
}

export function EvolutionStatusBadge({
  status,
  hasError,
  className = '',
}: EvolutionStatusBadgeProps): React.JSX.Element {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${style} ${className}`}
      data-testid={`status-badge-${status}`}
    >
      {hasError && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--status-error)]"
          title="Run has error details"
          data-testid="error-dot"
        />
      )}
      <span className="leading-none" data-testid="status-icon">{STATUS_ICONS[status]}</span>
      {status === 'claimed' ? 'starting' : status}
    </span>
  );
}
