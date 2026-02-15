// Visible error/warning block replacing hidden title={error} tooltips in agent detail views.
// Renders as a colored card with categorized message, expandable for long errors.

'use client';

import { useState } from 'react';

type ErrorCategory = 'api' | 'format' | 'timeout' | 'unknown';

function categorizeError(message: string): ErrorCategory {
  const lower = message.toLowerCase();
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('deadline')) return 'timeout';
  if (lower.includes('format') || lower.includes('parse') || lower.includes('json') || lower.includes('schema')) return 'format';
  if (lower.includes('api') || lower.includes('rate limit') || lower.includes('429') || lower.includes('500') || lower.includes('503')) return 'api';
  return 'unknown';
}

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  api: 'API Error',
  format: 'Format Error',
  timeout: 'Timeout',
  unknown: 'Error',
};

interface AgentErrorBlockProps {
  /** The error message to display. */
  error: string;
  /** Optional list of format issues to show as a bulleted list. */
  formatIssues?: string[];
  /** Render inline (compact) vs block (full card). Default: 'inline' */
  variant?: 'inline' | 'block';
}

export function AgentErrorBlock({ error, formatIssues, variant = 'inline' }: AgentErrorBlockProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const category = categorizeError(error);
  const isLong = error.length > 80;

  if (variant === 'inline') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[var(--status-error)] cursor-help"
        data-testid="agent-error-inline"
      >
        <span className="text-xs font-ui">{CATEGORY_LABELS[category]}</span>
        {isLong ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs underline hover:no-underline"
          >
            {expanded ? 'hide' : 'details'}
          </button>
        ) : (
          <span className="text-xs opacity-75">— {error}</span>
        )}
        {expanded && (
          <span className="block text-xs opacity-75 mt-0.5 break-words">{error}</span>
        )}
      </span>
    );
  }

  return (
    <div
      className="border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 rounded-page px-3 py-2 text-xs space-y-1"
      data-testid="agent-error-block"
    >
      <div className="flex items-center gap-2">
        <span className="text-[var(--status-error)] font-ui font-medium">{CATEGORY_LABELS[category]}</span>
      </div>
      <div className="text-[var(--status-error)] opacity-80 break-words">
        {isLong && !expanded ? (
          <>
            {error.substring(0, 80)}…{' '}
            <button type="button" onClick={() => setExpanded(true)} className="underline hover:no-underline">
              more
            </button>
          </>
        ) : (
          error
        )}
      </div>
      {formatIssues && formatIssues.length > 0 && (
        <ul className="list-disc list-inside text-[var(--status-warning)] space-y-0.5 mt-1">
          {formatIssues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
