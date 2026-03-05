// Shows the input variant an agent operated on, with preview, strategy badge, and Elo.
// Used on the invocation detail page to provide context for what the agent saw.

'use client';

import { useState } from 'react';
import { ShortId } from '@evolution/components/evolution/agentDetails/shared';

interface InputArticleSectionProps {
  variantId: string;
  strategy: string;
  text: string;
  textMissing?: boolean;
  elo: number | null;
  runId?: string;
  previewLength?: number;
}

export function InputArticleSection({
  variantId,
  strategy,
  text,
  textMissing,
  elo,
  runId,
  previewLength = 300,
}: InputArticleSectionProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > previewLength;
  const displayed = expanded || !needsTruncation ? text : text.slice(0, previewLength) + '…';

  return (
    <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4" data-testid="input-article-section">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-ui font-medium text-[var(--text-secondary)] uppercase tracking-wide">Input Variant</span>
        <ShortId id={variantId} runId={runId} />
        <span className="text-xs text-[var(--text-muted)]">{strategy}</span>
        {elo != null && (
          <span className="text-xs text-[var(--text-muted)] font-mono">Elo {Math.round(elo)}</span>
        )}
      </div>

      {textMissing ? (
        <div className="text-xs text-[var(--text-muted)] italic">Variant text not available</div>
      ) : (
        <>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono p-3 bg-[var(--surface-secondary)] rounded-book max-h-[300px] overflow-y-auto">
            {displayed}
          </pre>
          {needsTruncation && (
            <button
              onClick={() => setExpanded(prev => !prev)}
              className="mt-1 text-xs text-[var(--accent-gold)] hover:underline"
              data-testid="input-expand-toggle"
            >
              {expanded ? 'Show less' : 'Show full'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
