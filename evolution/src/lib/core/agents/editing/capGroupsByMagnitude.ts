// Mode B helper: cap the number of groups passed to the approver. Sorts by
// total character delta (oldText.length + newText.length per atomic edit, summed
// across the group) descending and keeps the top K. Per Decision #18: K=10 by
// default. To prevent the cap from systematically dropping all edits in one
// markdown section, the policy ALSO retains the top-1 group per heading-bounded
// section before applying the global top-K rule (R4.B F3 mitigation).

import type { EditingGroup, EditingDroppedGroup } from '../../../types';

const DEFAULT_K = 10;

/** Total character delta for a group (sum of |oldText| + |newText| per atomic). */
function groupMagnitude(g: EditingGroup): number {
  return g.atomicEdits.reduce((s, e) => s + (e.oldText?.length ?? 0) + (e.newText?.length ?? 0), 0);
}

/** Find the heading-bounded section index a position belongs to. Sections are
 *  delimited by lines starting with `#` (any heading level) in the source.
 *  Returns 0 for content before any heading; 1 for content after the first
 *  heading; etc. */
function sectionIndexAt(source: string, pos: number): number {
  // Build a sorted list of heading line-start positions.
  const headings: number[] = [];
  const re = /(?:^|\n)#{1,6}\s/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    // m.index is at the newline (or 0 for first); add 1 to skip past the \n
    // unless we're at offset 0.
    headings.push(m.index === 0 ? 0 : m.index + 1);
  }
  // Section index = how many headings begin at or before `pos`.
  let idx = 0;
  for (const h of headings) {
    if (h <= pos) idx++;
    else break;
  }
  return idx;
}

export interface CapResult {
  kept: EditingGroup[];
  dropped: EditingDroppedGroup[];
}

/** Returns top-K by magnitude, with one-per-section retention applied first. */
export function capGroupsByMagnitude(
  groups: EditingGroup[],
  source: string,
  k: number = DEFAULT_K,
): CapResult {
  if (groups.length <= k) return { kept: [...groups], dropped: [] };

  // Tag each group with (magnitude, sectionIndex).
  const tagged = groups.map((g) => ({
    g,
    magnitude: groupMagnitude(g),
    section: sectionIndexAt(source, Math.min(...g.atomicEdits.map((e) => e.range.start))),
  }));

  // Step 1: per-section top-1 retention. Group by section, keep best.
  const bestPerSection = new Map<number, typeof tagged[number]>();
  for (const t of tagged) {
    const cur = bestPerSection.get(t.section);
    if (!cur || t.magnitude > cur.magnitude) bestPerSection.set(t.section, t);
  }
  const sectionWinners = new Set([...bestPerSection.values()].map((t) => t.g));

  // Step 2: among the remaining (non-section-winner) groups, sort by magnitude
  // and fill up to K total.
  const winners: typeof tagged = [...bestPerSection.values()];
  if (winners.length >= k) {
    // Already over budget on section-winners alone; keep top-K of those.
    winners.sort((a, b) => b.magnitude - a.magnitude);
    const kept = winners.slice(0, k).map((t) => t.g);
    const droppedGroups = [
      ...winners.slice(k).map((t) => t.g),
      ...tagged.filter((t) => !sectionWinners.has(t.g)).map((t) => t.g),
    ];
    return {
      kept,
      dropped: droppedGroups.map((g) => ({ groupNumber: g.groupNumber, reason: 'dropped_by_magnitude_cap' as const })),
    };
  }
  const remainingSlots = k - winners.length;
  const candidates = tagged
    .filter((t) => !sectionWinners.has(t.g))
    .sort((a, b) => b.magnitude - a.magnitude);
  const fillers = candidates.slice(0, remainingSlots);
  const overflow = candidates.slice(remainingSlots);

  return {
    kept: [...winners.map((t) => t.g), ...fillers.map((t) => t.g)],
    dropped: overflow.map((t) => ({ groupNumber: t.g.groupNumber, reason: 'dropped_by_magnitude_cap' as const })),
  };
}
