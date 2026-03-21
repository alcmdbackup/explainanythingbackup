// Collapsible execution_detail JSONB display for invocation detail pages.
'use client';

import { useState } from 'react';

interface Props {
  detail: Record<string, unknown> | null;
}

export function InvocationExecutionDetail({ detail }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  if (!detail) {
    return (
      <div className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4" data-testid="execution-detail">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Execution Detail</h2>
        <p className="text-xs text-[var(--text-muted)] mt-2">No execution detail available.</p>
      </div>
    );
  }

  return (
    <div className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4" data-testid="execution-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Execution Detail</h2>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-[var(--accent-gold)] hover:underline font-ui"
          data-testid="toggle-detail"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {expanded && (
        <pre className="mt-3 text-xs text-[var(--text-secondary)] bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page p-3 overflow-x-auto max-h-96 overflow-y-auto">
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </div>
  );
}
