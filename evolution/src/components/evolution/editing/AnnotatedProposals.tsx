// AnnotatedProposals — color-coded inline rendering of the Proposer's marked-up
// article showing each [#N] edit group's accept/reject/dropped decision visually
// over the source text. Per Decisions §13/§14 + Phase 4.8 in the planning doc.
//
// Inputs come from execution_detail.cycles[i]:
//   - proposedMarkup: the marked-up article body (Proposer's raw output)
//   - proposedGroupsRaw: parsed groups with markupRange positions
//   - reviewDecisions: Approver's accept/reject decisions per group
//   - droppedPreApprover: groups dropped by the deterministic pre-check
//   - droppedPostApprover: groups dropped after Approver decision (overlap, context-mismatch)
//
// Visual encoding:
//   - Accepted   = solid green (var(--status-success))
//   - Rejected   = red strikethrough (var(--status-error))
//   - Dropped pre-Approver  = striped yellow (parser/hard-rule violation)
//   - Dropped post-Approver = striped orange (context/overlap mismatch)
//
// Toolbar offers three view modes: Annotated (default), Final variant
// (only-accepted reconstruction), Original (markup stripped).

'use client';

import { useMemo, useState } from 'react';
import type {
  EditingGroup,
  EditingReviewDecision,
  EditingDroppedGroup,
} from '@evolution/lib/types';

interface AnnotatedProposalsProps {
  proposedMarkup: string;
  proposedGroupsRaw: EditingGroup[];
  reviewDecisions?: EditingReviewDecision[];
  droppedPreApprover?: EditingDroppedGroup[];
  droppedPostApprover?: EditingDroppedGroup[];
  appliedGroups?: EditingGroup[];
  parentText?: string;
}

type ViewMode = 'annotated' | 'final' | 'original';
type Outcome = 'accepted' | 'rejected' | 'dropped_pre' | 'dropped_post' | 'unknown';

interface SegmentSpan {
  /** Slice of proposedMarkup [start, end). When the span has groupNumber it's an
   *  edit-markup span; otherwise it's plain text outside any markup. */
  start: number;
  end: number;
  groupNumber: number | null;
  outcome: Outcome;
}

const OUTCOME_STYLE: Record<Outcome, string> = {
  accepted: 'bg-[var(--status-success)]/15 text-[var(--status-success)] border border-[var(--status-success)]/40',
  rejected: 'bg-[var(--status-error)]/15 text-[var(--status-error)] line-through border border-[var(--status-error)]/40',
  dropped_pre: 'bg-[var(--status-warning)]/10 text-[var(--status-warning)] border border-[var(--status-warning)]/40 [background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,currentColor_4px,currentColor_5px)] [background-blend-mode:multiply]',
  dropped_post: 'bg-[var(--accent-copper)]/10 text-[var(--accent-copper)] border border-[var(--accent-copper)]/40 [background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,currentColor_4px,currentColor_5px)] [background-blend-mode:multiply]',
  unknown: 'bg-[var(--surface-elevated)] text-[var(--text-muted)] border border-[var(--border-default)]',
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  accepted: 'Accepted',
  rejected: 'Rejected',
  dropped_pre: 'Dropped (pre-Approver)',
  dropped_post: 'Dropped (post-Approver)',
  unknown: 'Unknown',
};

function classifyGroup(
  groupNumber: number,
  decisions: EditingReviewDecision[],
  droppedPre: EditingDroppedGroup[],
  droppedPost: EditingDroppedGroup[],
): Outcome {
  if (droppedPre.some((d) => d.groupNumber === groupNumber)) return 'dropped_pre';
  if (droppedPost.some((d) => d.groupNumber === groupNumber)) return 'dropped_post';
  const dec = decisions.find((d) => d.groupNumber === groupNumber);
  if (dec?.decision === 'accept') return 'accepted';
  if (dec?.decision === 'reject') return 'rejected';
  return 'unknown';
}

/** Build non-overlapping segments covering [0, markup.length). Markup ranges
 *  are sorted by start; gaps between them become plain-text segments. */
function buildSegments(
  markup: string,
  groups: EditingGroup[],
  decisions: EditingReviewDecision[],
  droppedPre: EditingDroppedGroup[],
  droppedPost: EditingDroppedGroup[],
): SegmentSpan[] {
  const all = groups.flatMap((g) => g.atomicEdits.map((e) => ({
    groupNumber: g.groupNumber,
    start: e.markupRange.start,
    end: e.markupRange.end,
  })));
  all.sort((a, b) => a.start - b.start);

  const segments: SegmentSpan[] = [];
  let cursor = 0;
  for (const span of all) {
    if (span.start < cursor) continue; // skip overlap (shouldn't happen post-parser)
    if (span.start > cursor) {
      segments.push({ start: cursor, end: span.start, groupNumber: null, outcome: 'unknown' });
    }
    segments.push({
      start: span.start, end: span.end,
      groupNumber: span.groupNumber,
      outcome: classifyGroup(span.groupNumber, decisions, droppedPre, droppedPost),
    });
    cursor = span.end;
  }
  if (cursor < markup.length) {
    segments.push({ start: cursor, end: markup.length, groupNumber: null, outcome: 'unknown' });
  }
  return segments;
}

/** Strip CriticMarkup from proposedMarkup — keep insert+delete content's
 *  "deleted" text, drop "inserted" text. Used by the Original view. */
function stripMarkup(markup: string): string {
  return markup
    .replace(/\{\+\+\s*\[#\d+\]\s*([\s\S]*?)\s*\+\+\}/g, '')
    .replace(/\{--\s*\[#\d+\]\s*([\s\S]*?)\s*--\}/g, '$1')
    .replace(/\{~~\s*\[#\d+\]\s*([\s\S]*?)\s*~>\s*([\s\S]*?)\s*~~\}/g, '$1');
}

/** Reconstruct the article using only accepted-and-applied edits — i.e., the
 *  "final variant" the agent emitted from this cycle. */
function reconstructFinal(
  markup: string,
  appliedGroups: EditingGroup[],
): string {
  const acceptedGroupSet = new Set(appliedGroups.map((g) => g.groupNumber));
  return markup
    .replace(/\{\+\+\s*\[#(\d+)\]\s*([\s\S]*?)\s*\+\+\}/g, (_m, n, content) =>
      acceptedGroupSet.has(Number(n)) ? content : '')
    .replace(/\{--\s*\[#(\d+)\]\s*([\s\S]*?)\s*--\}/g, (_m, n, content) =>
      acceptedGroupSet.has(Number(n)) ? '' : content)
    .replace(/\{~~\s*\[#(\d+)\]\s*([\s\S]*?)\s*~>\s*([\s\S]*?)\s*~~\}/g, (_m, n, oldT, newT) =>
      acceptedGroupSet.has(Number(n)) ? newT : oldT);
}

export function AnnotatedProposals({
  proposedMarkup,
  proposedGroupsRaw,
  reviewDecisions = [],
  droppedPreApprover = [],
  droppedPostApprover = [],
  appliedGroups = [],
  parentText,
}: AnnotatedProposalsProps): JSX.Element {
  const [view, setView] = useState<ViewMode>('annotated');
  const [legendOpen, setLegendOpen] = useState(false);

  const segments = useMemo(
    () => buildSegments(proposedMarkup, proposedGroupsRaw, reviewDecisions, droppedPreApprover, droppedPostApprover),
    [proposedMarkup, proposedGroupsRaw, reviewDecisions, droppedPreApprover, droppedPostApprover],
  );

  const finalText = useMemo(() => reconstructFinal(proposedMarkup, appliedGroups), [proposedMarkup, appliedGroups]);
  const originalText = useMemo(() => parentText ?? stripMarkup(proposedMarkup), [proposedMarkup, parentText]);

  // Group-info popup state
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null);

  return (
    <div data-testid="annotated-proposals" className="text-sm">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="inline-flex rounded border border-[var(--border-default)] overflow-hidden text-xs font-ui">
          <button
            type="button"
            onClick={() => setView('annotated')}
            className={`px-3 py-1 ${view === 'annotated' ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]' : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]'}`}
            data-testid="annotated-view-annotated"
          >
            Annotated
          </button>
          <button
            type="button"
            onClick={() => setView('final')}
            className={`px-3 py-1 border-l border-[var(--border-default)] ${view === 'final' ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]' : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]'}`}
            data-testid="annotated-view-final"
          >
            Final variant
          </button>
          <button
            type="button"
            onClick={() => setView('original')}
            className={`px-3 py-1 border-l border-[var(--border-default)] ${view === 'original' ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]' : 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]'}`}
            data-testid="annotated-view-original"
          >
            Original
          </button>
        </div>
        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          className="text-xs font-ui text-[var(--text-secondary)] hover:underline"
          data-testid="annotated-legend-toggle"
        >
          {legendOpen ? 'Hide legend ▴' : 'Show legend ▾'}
        </button>
      </div>

      {legendOpen && (
        <div className="mb-2 flex flex-wrap gap-2 text-xs font-ui" data-testid="annotated-legend">
          {(Object.keys(OUTCOME_STYLE) as Outcome[]).filter((o) => o !== 'unknown').map((o) => (
            <span key={o} className={`px-2 py-0.5 rounded ${OUTCOME_STYLE[o]}`}>
              {OUTCOME_LABEL[o]}
            </span>
          ))}
        </div>
      )}

      {view === 'annotated' && (
        <pre
          className="whitespace-pre-wrap font-mono leading-relaxed p-3 bg-[var(--surface-secondary)] rounded border border-[var(--border-default)] max-h-[600px] overflow-y-auto"
          data-testid="annotated-content"
        >
          {segments.map((seg, i) => {
            const text = proposedMarkup.slice(seg.start, seg.end);
            if (seg.groupNumber === null) {
              return <span key={i}>{text}</span>;
            }
            const decision = reviewDecisions.find((d) => d.groupNumber === seg.groupNumber);
            const droppedReason = droppedPreApprover.find((d) => d.groupNumber === seg.groupNumber)?.reason
              ?? droppedPostApprover.find((d) => d.groupNumber === seg.groupNumber)?.reason;
            const tooltip = decision?.reason ?? droppedReason ?? OUTCOME_LABEL[seg.outcome];
            const highlighted = hoveredGroup === seg.groupNumber;
            return (
              <span
                key={i}
                className={`px-1 rounded ${OUTCOME_STYLE[seg.outcome]} ${highlighted ? 'ring-2 ring-[var(--accent-gold)]' : ''}`}
                onMouseEnter={() => setHoveredGroup(seg.groupNumber)}
                onMouseLeave={() => setHoveredGroup(null)}
                title={`[#${seg.groupNumber}] ${OUTCOME_LABEL[seg.outcome]}: ${tooltip}`}
                data-testid={`annotated-group-${seg.groupNumber}`}
                data-outcome={seg.outcome}
              >
                <sup className="text-[10px] mr-0.5 opacity-70">#{seg.groupNumber}</sup>
                {text}
              </span>
            );
          })}
        </pre>
      )}

      {view === 'final' && (
        <pre
          className="whitespace-pre-wrap font-mono leading-relaxed p-3 bg-[var(--surface-secondary)] rounded border border-[var(--border-default)] max-h-[600px] overflow-y-auto"
          data-testid="annotated-final"
        >
          {finalText}
        </pre>
      )}

      {view === 'original' && (
        <pre
          className="whitespace-pre-wrap font-mono leading-relaxed p-3 bg-[var(--surface-secondary)] rounded border border-[var(--border-default)] max-h-[600px] overflow-y-auto"
          data-testid="annotated-original"
        >
          {originalText}
        </pre>
      )}
    </div>
  );
}
