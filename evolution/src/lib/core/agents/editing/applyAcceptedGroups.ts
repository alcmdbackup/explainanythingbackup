// Deterministic position-based applier. Takes accepted groups, validates each
// atomic edit's context-string failsafe + oldText match against currentText,
// drops mismatching groups, sorts surviving atomic edits by range.start
// descending, applies right-to-left so earlier offsets don't shift.

import type { EditingGroup, EditingDroppedGroup, ApplyResult, EditingReviewDecision } from './types';

function rangesOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export function applyAcceptedGroups(
  groups: EditingGroup[],
  decisions: EditingReviewDecision[],
  currentText: string,
): ApplyResult {
  const acceptedGroupNumbers = new Set(
    decisions.filter((d) => d.decision === 'accept').map((d) => d.groupNumber),
  );
  const acceptedGroups = groups.filter((g) => acceptedGroupNumbers.has(g.groupNumber));

  const droppedPostApprover: EditingDroppedGroup[] = [];
  const appliedGroups: EditingGroup[] = [];

  // Sort groups by groupNumber so early groups win on overlap.
  const sortedAcceptedGroups = [...acceptedGroups].sort((a, b) => a.groupNumber - b.groupNumber);

  // Detect overlap between groups (any atomic edit overlap → drop the later group).
  const accumulatedRanges: Array<{ start: number; end: number }> = [];
  const survivingGroups: EditingGroup[] = [];
  for (const g of sortedAcceptedGroups) {
    const groupRanges = g.atomicEdits.map((e) => e.range);
    const conflicts = groupRanges.some((gr) => accumulatedRanges.some((ar) => rangesOverlap(gr, ar)));
    if (conflicts) {
      droppedPostApprover.push({ groupNumber: g.groupNumber, reason: 'range_overlap_with_earlier_group' });
      continue;
    }
    // Verify context + oldText match for each atomic edit in the group.
    let groupValid = true;
    for (const e of g.atomicEdits) {
      const actualOld = currentText.slice(e.range.start, e.range.end);
      if (actualOld !== e.oldText) {
        droppedPostApprover.push({ groupNumber: g.groupNumber, reason: 'oldText_mismatch' });
        groupValid = false;
        break;
      }
      const actualBefore = currentText.slice(Math.max(0, e.range.start - e.contextBefore.length), e.range.start);
      const actualAfter = currentText.slice(e.range.end, Math.min(currentText.length, e.range.end + e.contextAfter.length));
      if (actualBefore !== e.contextBefore || actualAfter !== e.contextAfter) {
        droppedPostApprover.push({ groupNumber: g.groupNumber, reason: 'context_mismatch' });
        groupValid = false;
        break;
      }
    }
    if (groupValid) {
      survivingGroups.push(g);
      groupRanges.forEach((r) => accumulatedRanges.push(r));
    }
  }

  // Collect all surviving atomic edits, sort by range.start descending, apply.
  const allEdits = survivingGroups.flatMap((g) => g.atomicEdits);
  allEdits.sort((a, b) => b.range.start - a.range.start);

  let newText = currentText;
  for (const e of allEdits) {
    newText = newText.slice(0, e.range.start) + e.newText + newText.slice(e.range.end);
  }

  // Per Decisions §14 / Phase 2.A.1 contract table — format validation runs
  // outside this function (the agent calls enforceVariantFormat after apply
  // and aborts the cycle on failure). Here we just report whether an obvious
  // format-breaking mutation happened (e.g., empty result).
  const formatValid = newText.length > 0;

  return {
    newText,
    appliedGroups: survivingGroups,
    droppedPostApprover,
    formatValid,
  };
}
