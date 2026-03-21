// Displays full variant content text with expand/collapse toggle.
// Shows a preview of the content with option to see the complete text.

'use client';

import { useState } from 'react';

interface VariantContentSectionProps {
  content: string;
}

const PREVIEW_LENGTH = 500;

export function VariantContentSection({ content }: VariantContentSectionProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > PREVIEW_LENGTH;
  const displayText = expanded || !isLong ? content : content.slice(0, PREVIEW_LENGTH) + '...';

  return (
    <div
      className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-6 space-y-3"
      data-testid="variant-content-section"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Content</h2>
        {isLong && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-[var(--accent-gold)] hover:underline"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
      <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap font-body leading-relaxed">
        {displayText}
      </div>
    </div>
  );
}
