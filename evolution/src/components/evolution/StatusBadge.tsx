// Unified status badge component for evolution admin pages.
// Supports filled (default) and outlined styles, with optional pulse dot for active states.

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

const VARIANT_COLORS: Record<BadgeVariant, Record<string, string>> = {
  'run-status': {
    completed: 'bg-green-100 text-green-800',
    running: 'bg-blue-100 text-blue-800',
    pending: 'bg-yellow-100 text-yellow-800',
    claimed: 'bg-yellow-100 text-yellow-800',
    failed: 'bg-red-100 text-red-800',
    paused: 'bg-gray-100 text-gray-800',
    cancelled: 'bg-red-100 text-red-800',
  },
  'entity-status': {
    active: 'bg-green-100 text-green-800',
    archived: 'bg-gray-100 text-gray-600',
  },
  'pipeline-type': {
    full: 'bg-purple-100 text-purple-800',
    single: 'bg-indigo-100 text-indigo-800',
    v2: 'bg-teal-100 text-teal-800',
  },
  'generation-method': {
    article: 'bg-blue-100 text-blue-800',
    prompt: 'bg-orange-100 text-orange-800',
  },
  'invocation-status': {
    true: 'bg-green-100 text-green-800',
    false: 'bg-red-100 text-red-800',
  },
  'experiment-status': {
    running: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    analyzing: 'bg-blue-100 text-blue-800',
    pending: 'bg-yellow-100 text-yellow-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-red-100 text-red-800',
    draft: 'bg-gray-100 text-gray-800',
    archived: 'bg-gray-100 text-gray-600',
  },
  winner: {
    true: 'bg-amber-100 text-amber-800',
    false: 'bg-gray-100 text-gray-600',
  },
};

/** CSS variable colors for outlined style (maps status → design system token). */
const OUTLINED_COLORS: Record<BadgeVariant, Record<string, string>> = {
  'experiment-status': {
    pending: 'var(--text-muted)',
    running: 'var(--accent-gold)',
    analyzing: 'var(--accent-gold)',
    completed: 'var(--status-success)',
    failed: 'var(--status-error)',
    cancelled: 'var(--text-muted)',
    draft: 'var(--text-muted)',
    archived: 'var(--text-muted)',
  },
  'run-status': {},
  'entity-status': {},
  'pipeline-type': {},
  'generation-method': {},
  'invocation-status': {},
  winner: {},
};

interface StatusBadgeProps {
  variant: BadgeVariant;
  status: string;
  /** 'filled' (default) uses Tailwind bg classes; 'outlined' uses CSS variable border+text. */
  badgeStyle?: 'filled' | 'outlined';
  /** Show animated pulse dot before label (useful for active/in-progress states). */
  pulse?: boolean;
  className?: string;
}

export function StatusBadge({ variant, status, badgeStyle = 'filled', pulse = false, className = '' }: StatusBadgeProps) {
  const key = status.toLowerCase();
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const label = variant === 'winner'
    ? (status === 'true' ? 'Winner' : '')
    : variant === 'invocation-status'
      ? (status === 'true' ? 'Success' : 'Failed')
      : capitalize(status);

  if (!label) return null;

  if (badgeStyle === 'outlined') {
    const color = OUTLINED_COLORS[variant]?.[key] ?? 'var(--text-muted)';
    return (
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-ui font-medium border ${className}`}
        style={{ color, borderColor: color }}
        data-testid="status-badge"
      >
        {pulse && (
          <span
            className="w-1.5 h-1.5 rounded-full mr-1.5 animate-pulse"
            style={{ backgroundColor: color }}
          />
        )}
        {label}
      </span>
    );
  }

  const colors = VARIANT_COLORS[variant]?.[key] ?? 'bg-gray-100 text-gray-600';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-ui font-medium ${colors} ${className}`}
    >
      {label}
    </span>
  );
}
