// Unified status badge component for evolution admin pages.
// Replaces 7 separate badge implementations with a single config-driven component.

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
    draft: 'bg-gray-100 text-gray-800',
    archived: 'bg-gray-100 text-gray-600',
  },
  winner: {
    true: 'bg-amber-100 text-amber-800',
    false: 'bg-gray-100 text-gray-600',
  },
};

interface StatusBadgeProps {
  variant: BadgeVariant;
  status: string;
  className?: string;
}

export function StatusBadge({ variant, status, className = '' }: StatusBadgeProps) {
  const colors = VARIANT_COLORS[variant]?.[status.toLowerCase()] ?? 'bg-gray-100 text-gray-600';
  const label = variant === 'winner'
    ? (status === 'true' ? 'Winner' : '')
    : variant === 'invocation-status'
      ? (status === 'true' ? 'Success' : 'Failed')
      : status;

  if (!label) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-ui font-medium ${colors} ${className}`}
    >
      {label}
    </span>
  );
}
