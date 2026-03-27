// Reusable text diff viewer with Before/After/Diff tabs and expandable preview.
// Uses word-level diffing from the `diff` package with green/red highlighting.

'use client';

import { useState, useMemo } from 'react';
import { diffWordsWithSpace } from 'diff';

type Tab = 'before' | 'after' | 'diff';

interface TextDiffProps {
  original: string;
  modified: string;
  previewLength?: number;
}

function TextPreview({ text, previewLength }: { text: string; previewLength: number }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > previewLength;
  const displayed = expanded || !needsTruncation ? text : text.slice(0, previewLength) + '…';

  return (
    <div>
      <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono p-4 bg-[var(--surface-secondary)] rounded-book max-h-[500px] overflow-y-auto">
        {displayed}
      </pre>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(prev => !prev)}
          className="mt-1 text-xs text-[var(--accent-gold)] hover:underline"
          data-testid="expand-toggle"
        >
          {expanded ? 'Show less' : 'Show full'}
        </button>
      )}
    </div>
  );
}

function DiffView({ original, modified, previewLength }: { original: string; modified: string; previewLength: number }) {
  const [expanded, setExpanded] = useState(false);
  const parts = useMemo(() => diffWordsWithSpace(original, modified), [original, modified]);

  // Compute total visible length for truncation
  const fullLength = parts.reduce((sum, p) => sum + p.value.length, 0);
  const needsTruncation = fullLength > previewLength;

  let remaining = expanded || !needsTruncation ? Infinity : previewLength;

  return (
    <div>
      <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono p-4 bg-[var(--surface-secondary)] rounded-book max-h-[500px] overflow-y-auto" data-testid="diff-content">
        {parts.map((part, i) => {
          if (remaining <= 0) return null;
          const text = remaining < part.value.length ? part.value.slice(0, remaining) + '…' : part.value;
          remaining -= part.value.length;

          if (part.added) {
            return (
              <span key={i} className="bg-[var(--status-success)]/20 text-[var(--status-success)]">
                {text}
              </span>
            );
          }
          if (part.removed) {
            return (
              <span key={i} className="bg-[var(--status-error)]/20 text-[var(--status-error)] line-through">
                {text}
              </span>
            );
          }
          return <span key={i}>{text}</span>;
        })}
      </pre>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(prev => !prev)}
          className="mt-1 text-xs text-[var(--accent-gold)] hover:underline"
          data-testid="expand-toggle"
        >
          {expanded ? 'Show less' : 'Show full'}
        </button>
      )}
    </div>
  );
}

export function TextDiff({ original, modified, previewLength = 300 }: TextDiffProps): JSX.Element {
  const hasOriginal = original.length > 0;
  const defaultTab: Tab = 'diff';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  const tabs: { id: Tab; label: string }[] = [
    ...(hasOriginal ? [{ id: 'before' as Tab, label: 'Before' }] : []),
    { id: 'after', label: 'After' },
    { id: 'diff', label: 'Diff' },
  ];

  return (
    <div data-testid="text-diff">
      <div className="flex gap-1 mb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs rounded-t transition-colors ${
              activeTab === tab.id
                ? 'bg-[var(--surface-secondary)] text-[var(--text-primary)] font-medium'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            data-testid={`tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'before' && hasOriginal && (
        <TextPreview text={original} previewLength={previewLength} />
      )}
      {activeTab === 'after' && (
        <TextPreview text={modified} previewLength={previewLength} />
      )}
      {activeTab === 'diff' && (
        <DiffView original={original} modified={modified} previewLength={previewLength} />
      )}
    </div>
  );
}
