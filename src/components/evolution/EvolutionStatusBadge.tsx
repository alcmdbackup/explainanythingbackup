// Reusable status badge for evolution run statuses.
// Replaces the inline statusColor() function from the evolution admin page.
'use client';

import type { EvolutionRunStatus } from '@/lib/evolution/types';

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
  paused:
    'bg-[var(--text-secondary)]/20 text-[var(--text-secondary)] border-[var(--text-secondary)]/30',
};

export function EvolutionStatusBadge({
  status,
  className = '',
}: {
  status: EvolutionRunStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${style} ${className}`}
      data-testid={`status-badge-${status}`}
    >
      {status}
    </span>
  );
}
