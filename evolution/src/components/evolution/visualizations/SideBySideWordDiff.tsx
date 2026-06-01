// Side-by-side word-level diff: Parent (left) vs This variant (right). The left column
// highlights removed words (strikethrough) and the right column highlights added words,
// so both A→B and B→A edits read at a glance from one symmetric `diffWordsWithSpace` pass.
// Standalone (not a mode on TextDiff) so existing TextDiff consumers stay unchanged.
// enable_side_by_side_variant_comparisons_vs_parent_20260531.

'use client';

import { useMemo, useState } from 'react';
import { diffWordsWithSpace } from 'diff';

interface SideBySideWordDiffProps {
  /** Left column — the parent/original (A). */
  parent: string;
  /** Right column — this variant/modified (B). */
  variant: string;
  /** Per-column visible character budget before truncation. */
  previewLength?: number;
}

const PRE_CLASS =
  'whitespace-pre-wrap text-sm leading-relaxed font-mono p-4 bg-[var(--surface-secondary)] rounded-book max-h-[500px] overflow-y-auto';

export function SideBySideWordDiff({ parent, variant, previewLength = 600 }: SideBySideWordDiffProps): JSX.Element {
  const parts = useMemo(() => diffWordsWithSpace(parent, variant), [parent, variant]);
  const [expanded, setExpanded] = useState(false);

  const budget = expanded ? Infinity : previewLength;

  // Left ('parent') renders unchanged + removed parts; right ('variant') renders
  // unchanged + added parts. Each column truncates independently against `budget`.
  const renderColumn = (side: 'parent' | 'variant'): JSX.Element[] => {
    let remaining = budget;
    const nodes: JSX.Element[] = [];
    parts.forEach((part, i) => {
      if (remaining <= 0) return;
      const include = side === 'parent' ? !part.added : !part.removed;
      if (!include) return;
      const text = remaining < part.value.length ? part.value.slice(0, remaining) + '…' : part.value;
      remaining -= part.value.length;
      if (part.added && side === 'variant') {
        nodes.push(
          <span key={i} className="bg-[var(--status-success)]/20 text-[var(--status-success)]">{text}</span>,
        );
      } else if (part.removed && side === 'parent') {
        nodes.push(
          <span key={i} className="bg-[var(--status-error)]/20 text-[var(--status-error)] line-through">{text}</span>,
        );
      } else {
        nodes.push(<span key={i}>{text}</span>);
      }
    });
    return nodes;
  };

  const fullLength = parts.reduce((sum, p) => sum + p.value.length, 0);
  const needsTruncation = fullLength > previewLength;

  return (
    <div data-testid="sxs-diff">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-ui text-[var(--text-muted)] mb-1">Parent</div>
          <pre data-testid="sxs-parent" className={PRE_CLASS}>{renderColumn('parent')}</pre>
        </div>
        <div>
          <div className="text-xs font-ui text-[var(--text-muted)] mb-1">This variant</div>
          <pre data-testid="sxs-variant" className={PRE_CLASS}>{renderColumn('variant')}</pre>
        </div>
      </div>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(prev => !prev)}
          className="mt-1 text-xs text-[var(--accent-gold)] hover:underline"
          data-testid="sxs-expand-toggle"
        >
          {expanded ? 'Show less' : 'Show full'}
        </button>
      )}
    </div>
  );
}
