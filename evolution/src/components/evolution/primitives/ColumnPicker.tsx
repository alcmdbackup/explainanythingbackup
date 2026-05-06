// Shared <details>-based column-visibility picker. Used by the runs list and
// the arena leaderboard so we don't duplicate the popover markup + checkbox
// state plumbing in two pages.
//
// Fix #51 (use_playwright_find_ux_issues_bugs_20260501): extracted from
// runs/page.tsx; the original inline ColumnPicker now imports from here.

'use client';

import React from 'react';

interface ColumnPickerProps {
  allColumns: { key: string; label: string }[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Defaults to "runs-column-picker" for backward compat with existing E2E
   *  selectors. Override per-page (e.g. "arena-leaderboard-column-picker"). */
  testId?: string;
}

export function ColumnPicker({ allColumns, hidden, onChange, testId = 'runs-column-picker' }: ColumnPickerProps): JSX.Element {
  const visibleCount = allColumns.length - hidden.size;
  return (
    <details className="relative inline-block" data-testid={testId}>
      <summary className="cursor-pointer text-xs font-ui px-3 py-1 border border-[var(--border-default)] rounded-page bg-[var(--surface-secondary)] inline-block">
        Columns ({visibleCount}/{allColumns.length})
      </summary>
      <div className="absolute z-10 mt-1 right-0 w-64 max-h-80 overflow-y-auto p-2 border border-[var(--border-default)] rounded-page bg-[var(--surface-elevated)] shadow-warm-lg">
        {allColumns.map(c => (
          <label key={c.key} className="flex items-center gap-2 px-1 py-1 text-xs font-ui cursor-pointer hover:bg-[var(--surface-secondary)] rounded">
            <input
              type="checkbox"
              checked={!hidden.has(c.key)}
              onChange={(e) => {
                const next = new Set(hidden);
                if (e.target.checked) {
                  next.delete(c.key);
                } else {
                  next.add(c.key);
                }
                onChange(next);
              }}
              data-testid={`column-toggle-${c.key}`}
            />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
