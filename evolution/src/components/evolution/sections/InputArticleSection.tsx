// Shows the input variant an agent operated on, with preview, tactic badge, and Elo.
// Used on the invocation detail page to provide context for what the agent saw.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatEloWithUncertainty } from '@evolution/lib/utils/formatters';

function ShortId({ id }: { id: string; runId?: string }): JSX.Element {
  return (
    <Link
      href={buildVariantDetailUrl(id)}
      className="font-mono text-xs text-[var(--accent-gold)] hover:underline"
      title={id}
    >
      {id.substring(0, 8)}
    </Link>
  );
}

interface InputArticleSectionProps {
  variantId: string;
  tactic: string;
  text: string;
  textMissing?: boolean;
  elo: number | null;
  /** Elo-scale rating uncertainty. When present, displays as "Elo {elo} ± {half}". Phase 4b. */
  uncertainty?: number | null;
  runId?: string;
  previewLength?: number;
}

export function InputArticleSection({
  variantId,
  tactic,
  text,
  textMissing,
  elo,
  uncertainty,
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
        <span className="text-xs text-[var(--text-muted)]">{tactic}</span>
        {elo != null && (
          <span className="text-xs text-[var(--text-muted)] font-mono">
            Elo {uncertainty != null
              ? (formatEloWithUncertainty(elo, uncertainty) ?? Math.round(elo))
              : Math.round(elo)}
          </span>
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
