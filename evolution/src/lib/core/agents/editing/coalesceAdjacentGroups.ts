// Mode B helper: post-diff group coalescer. Merges adjacent same-paragraph
// same-kind groups when separated by a small whitespace gap (< 24 chars,
// no paragraph break). Prevents the diff engine's per-word/per-sentence
// fragmentation from overwhelming the approver.
//
// Conservative defaults (Decision #17):
// - Gap threshold: 24 chars of UNCHANGED text between groups
// - Same-kind only: don't merge `del` with `ins`
// - Paragraph-boundary aware: never merge across `\n\n`

import type { EditingGroup } from '../../../types';

const GAP_THRESHOLD_CHARS = 24;

/** Returns true iff the bytes of `source` between `endA` and `startB` are
 *  whitespace only AND contain no paragraph break (`\n\n`). */
function gapIsBenign(source: string, endA: number, startB: number): boolean {
  if (endA > startB) return false;
  const between = source.slice(endA, startB);
  if (between.length > GAP_THRESHOLD_CHARS) return false;
  if (between.includes('\n\n')) return false;
  return /^[\s]*$/.test(between);
}

/** Returns the kind of a group. A "uniform" group has all atomic edits of one
 *  kind; a mixed group is treated as `replace` for coalescing purposes. */
function uniformKind(g: EditingGroup): 'insert' | 'delete' | 'replace' | 'mixed' {
  const kinds = new Set(g.atomicEdits.map((e) => e.kind));
  if (kinds.size === 1) return [...kinds][0]!;
  return 'mixed';
}

/** Returns the rightmost markup-end position for a group. Uses atomic edit's
 *  markupRange.end as a reasonable proxy for "where the group ends in source". */
function groupSourceEnd(g: EditingGroup): number {
  return Math.max(...g.atomicEdits.map((e) => e.range.end));
}

/** Returns the leftmost markup-start position for a group. */
function groupSourceStart(g: EditingGroup): number {
  return Math.min(...g.atomicEdits.map((e) => e.range.start));
}

/** Merge adjacent same-kind groups whose source-positions are separated only
 *  by a small whitespace gap. Returns a new array; does not mutate input. */
export function coalesceAdjacentGroups(groups: EditingGroup[], source: string): EditingGroup[] {
  if (groups.length <= 1) return [...groups];

  // Sort by source start position so we walk through the source in order.
  const sorted = [...groups].sort((a, b) => groupSourceStart(a) - groupSourceStart(b));

  const out: EditingGroup[] = [];
  for (const g of sorted) {
    const prev = out[out.length - 1];
    if (!prev) { out.push(g); continue; }
    const prevKind = uniformKind(prev);
    const gKind = uniformKind(g);
    const sameKind = prevKind !== 'mixed' && gKind !== 'mixed' && prevKind === gKind;
    if (!sameKind) { out.push(g); continue; }

    const prevEnd = groupSourceEnd(prev);
    const gStart = groupSourceStart(g);
    if (!gapIsBenign(source, prevEnd, gStart)) { out.push(g); continue; }

    // Merge: append g's atomic edits onto prev. Renumber atomic-edit groupNumbers
    // to prev.groupNumber so the merged group has consistent numbering.
    const mergedAtomics = [
      ...prev.atomicEdits,
      ...g.atomicEdits.map((e) => ({ ...e, groupNumber: prev.groupNumber })),
    ];
    out[out.length - 1] = { ...prev, atomicEdits: mergedAtomics };
  }
  return out;
}
