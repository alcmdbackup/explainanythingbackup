// Recombined-output tab for paragraph_recombine invocations. Renders the final
// recombined article with per-paragraph color coding (neutral = original kept,
// green = rewrite chosen) and surfaces format-validation issues at the top.
// Includes a toggle to view the original parent for side-by-side comparison.
'use client';

import { useMemo, useState } from 'react';
import type { SlotRecombineExecutionDetail } from '@evolution/lib/schemas';

interface RecombinedOutputTabProps {
  parentText: string | null;
  detail: SlotRecombineExecutionDetail;
}

export function RecombinedOutputTab({ parentText, detail }: RecombinedOutputTabProps): JSX.Element {
  const [view, setView] = useState<'recombined' | 'parent'>('recombined');

  const slotsByIndex = useMemo(() => {
    return new Map(detail.slots.map((s) => [s.slotIndex, s]));
  }, [detail.slots]);

  const renderText = view === 'recombined' ? detail.recombined.text : (parentText ?? '');

  // Split into paragraphs by \n\n for color coding. This matches extractParagraphsWithRanges'
  // segmentation so each rendered block aligns with a slot.
  const paragraphs = renderText.split(/\n\n+/).map((p, i) => ({ idx: i, text: p }));

  return (
    <div className="space-y-4" data-testid="recombined-output-tab">
      {!detail.recombined.formatValid && detail.recombined.formatIssues && detail.recombined.formatIssues.length > 0 && (
        <div
          className="border border-[var(--status-error)] rounded-book bg-[var(--surface-elevated)] p-3"
          data-testid="recombined-format-banner"
          role="alert"
        >
          <div className="text-sm font-display font-semibold text-[var(--status-error)] mb-1">
            Format validation failed — variant discarded
          </div>
          <ul className="list-disc pl-5 text-xs font-ui text-[var(--text-secondary)] space-y-1">
            {detail.recombined.formatIssues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2" role="tablist" aria-label="article view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'recombined'}
          onClick={() => setView('recombined')}
          className={`px-3 py-1 text-xs font-ui rounded ${
            view === 'recombined'
              ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
              : 'border border-[var(--border-default)]'
          }`}
          data-testid="view-recombined"
        >
          Recombined
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'parent'}
          onClick={() => setView('parent')}
          disabled={!parentText}
          className={`px-3 py-1 text-xs font-ui rounded ${
            view === 'parent'
              ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
              : 'border border-[var(--border-default)]'
          } disabled:opacity-40`}
          data-testid="view-parent"
        >
          Original parent
        </button>
        <div className="ml-auto text-xs text-[var(--text-muted)]">
          {detail.slots.filter((s) => s.ranking && !s.ranking.winnerIsOriginal).length} of {detail.slots.length} slots replaced
        </div>
      </div>

      <article className="space-y-3 bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-book p-4" data-testid="recombined-article">
        {paragraphs.map(({ idx, text }) => {
          // Slot index is paragraph-among-content-blocks, not raw split index. Without
          // re-running extractParagraphsWithRanges we approximate: blocks that look like
          // headings (start with #) get neutral chrome; others map to slot[N-skipped].
          const isHeading = /^#{1,6}\s/.test(text.trim());
          let slot = null;
          if (!isHeading && view === 'recombined') {
            // Approximate mapping: nth non-heading block → slot[n]. Same heuristic the
            // extractor uses, so 1:1 alignment in practice.
            const blocksBefore = paragraphs
              .slice(0, idx)
              .filter((p) => !/^#{1,6}\s/.test(p.text.trim())).length;
            slot = slotsByIndex.get(blocksBefore) ?? null;
          }
          const winnerIsRewrite = slot?.ranking && !slot.ranking.winnerIsOriginal;
          const borderClass = isHeading
            ? 'border-l-2 border-[var(--border-default)]'
            : winnerIsRewrite
              ? 'border-l-4 border-[#06b6d4]'
              : 'border-l-4 border-[var(--border-default)]';
          return (
            <div
              key={idx}
              className={`pl-3 ${borderClass}`}
              data-testid={`recombined-block-${idx}`}
              data-winner={winnerIsRewrite ? 'rewrite' : 'original'}
            >
              <p className="text-sm font-ui text-[var(--text-primary)] whitespace-pre-wrap">{text}</p>
              {slot && !isHeading && (
                <div className="mt-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
                  slot {slot.slotIndex + 1} · {winnerIsRewrite ? 'rewrite chosen' : 'original kept'}
                  {slot.discardReason && ` · ${slot.discardReason.failurePoint}`}
                </div>
              )}
            </div>
          );
        })}
      </article>
    </div>
  );
}
