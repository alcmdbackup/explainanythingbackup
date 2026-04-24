// Unified status badge for evolution admin pages.
// Supports filled (default) and outlined styles, hasError dot, status icons, and pulse dot.

'use client';

import React from 'react';

type BadgeVariant =
  | 'run-status'
  | 'entity-status'
  | 'pipeline-type'
  | 'generation-method'
  | 'invocation-status'
  | 'experiment-status'
  | 'winner';

/** Maps variant+status → CSS custom property color token. */
const VARIANT_COLORS: Record<BadgeVariant, Record<string, string>> = {
  'run-status': {
    completed: 'var(--status-success)',
    running: 'var(--accent-gold)',
    pending: 'var(--status-warning)',
    claimed: 'var(--text-muted)',
    failed: 'var(--status-error)',
    paused: 'var(--text-muted)',
    cancelled: 'var(--status-error)',
  },
  'entity-status': {
    active: 'var(--status-success)',
    archived: 'var(--text-muted)',
  },
  'pipeline-type': {
    full: 'var(--accent-primary)',
    single: 'var(--accent-blue)',
    v2: 'var(--accent-copper)',
  },
  'generation-method': {
    article: 'var(--accent-blue)',
    prompt: 'var(--accent-gold)',
  },
  'invocation-status': {
    true: 'var(--status-success)',
    false: 'var(--status-error)',
  },
  'experiment-status': {
    running: 'var(--accent-gold)',
    completed: 'var(--status-success)',
    analyzing: 'var(--accent-gold)',
    pending: 'var(--status-warning)',
    failed: 'var(--status-error)',
    cancelled: 'var(--status-error)',
    draft: 'var(--text-muted)',
    archived: 'var(--text-muted)',
  },
  winner: {
    true: 'var(--accent-gold)',
    false: 'var(--text-muted)',
  },
};

/** Status icons shown for run-status variant. */
const STATUS_ICONS: Record<string, string> = {
  pending: '\u23F3',   // hourglass
  claimed: '\u25B6',   // play (starting)
  running: '\u25B6',   // play
  completed: '\u2713', // checkmark
  failed: '\u2717',    // X mark
  cancelled: '\u23F9', // stop button
};

interface StatusBadgeProps {
  variant: BadgeVariant;
  status: string;
  /** 'filled' (default) uses semi-transparent bg; 'outlined' uses border+text only. */
  badgeStyle?: 'filled' | 'outlined';
  /** Show animated pulse dot before label (useful for active/in-progress states). */
  pulse?: boolean;
  /** Show small error dot indicator (useful for run-status badges). */
  hasError?: boolean;
  className?: string;
}

export function StatusBadge({ variant, status, badgeStyle = 'filled', pulse = false, hasError = false, className = '' }: StatusBadgeProps) {
  const key = status.toLowerCase();
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const label = variant === 'winner'
    ? (status === 'true' ? 'Winner' : '')
    : variant === 'invocation-status'
      ? (status === 'true' ? 'Success' : 'Failed')
      : variant === 'run-status' && key === 'claimed'
        ? 'Starting'
        : capitalize(status);

  if (!label) return null;

  const color = VARIANT_COLORS[variant]?.[key] ?? 'var(--text-muted)';
  const icon = variant === 'run-status' ? STATUS_ICONS[key] : undefined;
  const testId = variant === 'run-status' ? `status-badge-${key}` : 'status-badge';

  if (badgeStyle === 'outlined') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-ui font-medium border ${className}`}
        style={{ color, borderColor: color }}
        data-testid={testId}
        role="status"
        // U5 (use_playwright_find_bugs_ux_issues_20260422): drop "(has errors)" — "Failed"
      // implies errors already. The red dot still signals the error state.
      aria-label={`Status: ${label}`}
      >
        {hasError && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--status-error)]"
            title="Run has error details"
            data-testid="error-dot"
          />
        )}
        {pulse && (
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: color }}
          />
        )}
        {icon && <span className="leading-none" data-testid="status-icon">{icon}</span>}
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-ui font-medium border ${className}`}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`,
        color,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
      }}
      data-testid={testId}
      role="status"
      // U5 (use_playwright_find_bugs_ux_issues_20260422): drop "(has errors)" — "Failed"
      // implies errors already. The red dot still signals the error state.
      aria-label={`Status: ${label}`}
    >
      {hasError && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--status-error)]"
          title="Run has error details"
          data-testid="error-dot"
        />
      )}
      {pulse && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ backgroundColor: color }}
        />
      )}
      {icon && <span className="leading-none" data-testid="status-icon">{icon}</span>}
      {label}
    </span>
  );
}
