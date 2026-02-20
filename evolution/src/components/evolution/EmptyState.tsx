// Shared empty state component with icon, message, and optional call-to-action.
// Displays centered placeholder when tables, lists, or sections have no data.

import type { ReactNode } from 'react';

interface EmptyStateProps {
  message: string;
  suggestion?: string;
  icon?: string;
  action?: ReactNode;
  testId?: string;
}

export function EmptyState({ message, suggestion, icon = '\u2205', action, testId }: EmptyStateProps): JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 px-4 text-center"
      data-testid={testId ?? 'empty-state'}
    >
      <span className="text-3xl text-[var(--text-muted)] mb-3" aria-hidden="true">{icon}</span>
      <p className="text-sm font-body text-[var(--text-muted)]">{message}</p>
      {suggestion && (
        <p className="text-xs font-body text-[var(--text-muted)] mt-1 opacity-70">{suggestion}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
