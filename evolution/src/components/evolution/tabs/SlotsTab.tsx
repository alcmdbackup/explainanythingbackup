// Per-slot drill-in tab for paragraph_recombine invocations (D14/D17/D20).
// Master-detail layout: left lists N slot rows; right pane shows slot context
// + 2-tab embedded ArenaLeaderboardTable. Component is generic over granularity
// via kindLabel / slotNoun props so future sentence/section agents reuse it.
'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArenaLeaderboardTable } from '../arena/ArenaLeaderboardTable';
import { formatParagraphLabel } from '@evolution/lib/shared/paragraphLabels';
import { formatElo } from '@evolution/lib/utils/formatters';
import type { SlotRecombineExecutionDetail } from '@evolution/lib/schemas';

type SlotDetail = SlotRecombineExecutionDetail['slots'][number];

interface SlotsTabProps {
  parentVariantId: string;
  slots: SlotDetail[];
  kindLabel?: string;     // 'paragraph' for v1
  slotNoun?: string;      // 'paragraph'
  slotNounPlural?: string; // 'paragraphs'
}

function previewText(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function winnerSourceTag(slot: SlotDetail): string {
  if (!slot.ranking) return '—';
  switch (slot.ranking.winnerSource) {
    case 'this_invocation': return '(this inv)';
    case 'prior_invocation': return '(prior)';
    case 'original': return '(original)';
  }
}

function formatDelta(winnerElo: number, originalElo: number | null | undefined): string {
  if (originalElo == null) return '';
  const delta = Math.round(winnerElo - originalElo);
  if (delta === 0) return ' (tied vs orig)';
  return delta > 0 ? `, +${delta} vs orig` : `, ${delta} vs orig`;
}

export function SlotsTab({
  parentVariantId,
  slots,
  slotNoun = 'paragraph',
  slotNounPlural = 'paragraphs',
}: SlotsTabProps): JSX.Element {
  const [selectedIdx, setSelectedIdx] = useState<number>(slots[0]?.slotIndex ?? 0);
  const [filterMode, setFilterMode] = useState<'all' | 'this'>('all');

  const selectedSlot = useMemo(
    () => slots.find((s) => s.slotIndex === selectedIdx) ?? slots[0],
    [slots, selectedIdx],
  );

  if (!selectedSlot) {
    return (
      <div className="text-sm font-ui text-[var(--text-muted)] py-6" data-testid="slots-tab-empty">
        No {slotNounPlural} in this invocation.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4" data-testid="slots-tab">
      {/* Left pane: slot list */}
      <aside className="space-y-1 max-h-[70vh] overflow-y-auto pr-2" data-testid="slots-tab-list">
        <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] py-2 px-2">
          {slots.length} {slotNounPlural}
        </div>
        {slots.map((slot) => {
          const isSelected = slot.slotIndex === selectedSlot.slotIndex;
          const label = formatParagraphLabel({ parentId: parentVariantId, slotIndex: slot.slotIndex });
          const ranking = slot.ranking;
          const discard = slot.discardReason;
          const winnerLabel = ranking?.winnerIsOriginal ? 'original' : 'rewrite';
          const winnerRating = ranking?.ratings.find((r) => r.variantId === ranking.winnerSlotVariantId);
          const originalRating = ranking?.ratings.find((r) => r.variantId === slot.originalSlotVariantId);
          return (
            <button
              key={slot.slotIndex}
              type="button"
              onClick={() => setSelectedIdx(slot.slotIndex)}
              className={`w-full text-left p-2 rounded-book text-xs font-ui border ${
                isSelected
                  ? 'bg-[var(--surface-elevated)] border-[var(--accent-gold)]'
                  : 'bg-[var(--surface-secondary)] border-transparent hover:border-[var(--border-default)]'
              }`}
              data-testid={`slot-row-${slot.slotIndex}`}
            >
              <div className="font-mono text-[var(--text-primary)]">{label}</div>
              {ranking && winnerRating ? (
                <div className="text-[var(--text-secondary)] mt-1">
                  winner: {winnerLabel} {winnerSourceTag(slot)} Elo {formatElo(winnerRating.elo)} ± {Math.round(winnerRating.uncertainty)}
                  {!ranking.winnerIsOriginal && originalRating && formatDelta(winnerRating.elo, originalRating.elo)}
                </div>
              ) : discard ? (
                <div className="mt-1">
                  <span
                    className="inline-block px-2 py-0.5 rounded-full text-[10px] font-ui bg-[var(--status-error)] text-white"
                    data-testid={`slot-abort-badge-${slot.slotIndex}`}
                  >
                    ⚠ {discard.failurePoint} abort
                  </span>
                </div>
              ) : (
                <div className="text-[var(--text-muted)] mt-1">no ranking</div>
              )}
            </button>
          );
        })}
      </aside>

      {/* Right pane: slot context + embedded leaderboard */}
      <section className="space-y-3" data-testid="slots-tab-detail">
        <header className="border border-[var(--border-default)] rounded-book p-3 bg-[var(--surface-secondary)]">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">
            {slotNoun} slot {selectedSlot.slotIndex + 1} · context
          </div>
          <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap font-ui">
            {previewText(selectedSlot.originalText, 280)}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs font-ui text-[var(--text-muted)]">
            <span>budget: ${selectedSlot.perSlotBudgetUsd.toFixed(4)}</span>
            <span>spent: ${selectedSlot.spentUsd.toFixed(4)}</span>
            <span>rewrites: {selectedSlot.rewrites.length}</span>
            <span>dropped pre-rank: {selectedSlot.rewrites.filter((r) => r.dropReason).length}</span>
            {selectedSlot.discardReason && (
              <span className="text-[var(--status-error)]" data-testid="slot-failure-warning">
                failure: {selectedSlot.discardReason.failurePoint}{selectedSlot.discardReason.message ? ` — ${selectedSlot.discardReason.message}` : ''}
              </span>
            )}
            <Link
              href={`/admin/evolution/arena/${selectedSlot.slotTopicId}`}
              className="text-[var(--accent-gold)] hover:underline"
              data-testid="slot-arena-link"
            >
              View in arena ↗
            </Link>
          </div>
        </header>

        <div className="border border-[var(--border-default)] rounded-book p-3 bg-[var(--surface-elevated)]">
          <div className="flex items-center gap-1 mb-3" role="tablist" aria-label="leaderboard scope">
            <button
              type="button"
              role="tab"
              aria-selected={filterMode === 'all'}
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1 text-xs font-ui rounded ${
                filterMode === 'all'
                  ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
                  : 'border border-[var(--border-default)]'
              }`}
              data-testid="slot-tab-all"
            >
              All invocations
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filterMode === 'this'}
              onClick={() => setFilterMode('this')}
              className={`px-3 py-1 text-xs font-ui rounded ${
                filterMode === 'this'
                  ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
                  : 'border border-[var(--border-default)]'
              }`}
              data-testid="slot-tab-this"
            >
              Just this invocation
            </button>
          </div>

          {(() => {
            const thisInvocationIds = new Set<string>(
              selectedSlot.rewrites
                .map((r) => r.slotVariantId)
                .filter((v): v is string => Boolean(v)),
            );
            const totalThisInv = thisInvocationIds.size;
            const captionAll = `● = introduced by this invocation · ${totalThisInv} from this invocation`;
            const captionThis = `Showing ${totalThisInv} variant${totalThisInv === 1 ? '' : 's'} from this invocation (ranks remain absolute)`;
            return filterMode === 'all' ? (
              <ArenaLeaderboardTable
                key={`${selectedSlot.slotTopicId}-all`}
                topicId={selectedSlot.slotTopicId}
                highlightVariantIds={thisInvocationIds}
                bottomCaption={captionAll}
                storageKey="evolution-slots-tab-leaderboard-hidden-columns"
                hideCutoffCallout
              />
            ) : (
              <ArenaLeaderboardTable
                key={`${selectedSlot.slotTopicId}-this`}
                topicId={selectedSlot.slotTopicId}
                filterToVariantIds={thisInvocationIds}
                bottomCaption={captionThis}
                storageKey="evolution-slots-tab-leaderboard-hidden-columns"
                hideCutoffCallout
              />
            );
          })()}
        </div>
      </section>
    </div>
  );
}
