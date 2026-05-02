// Pre-Approver hard-rule validator. Applies group-level coherence: any atomic
// edit in a group fails any rule → the WHOLE group is dropped. Plus per-cycle
// and per-group caps.
//
// Rules enforced:
//   - newText length ≤ EDIT_NEWTEXT_LENGTH_CAP (500 chars)
//   - oldText / newText must not contain "\n\n" (paragraph break)
//   - range must not cross a heading line (^#+ )
//   - newText must not introduce a heading line
//   - oldText / newText must not contain code-fence markers (```)
//   - range must not cross a list-item boundary (^[\-\*\+] )
//   - oldText / newText must not introduce a horizontal-rule line (^---$)
//
// Plus the Decisions §17 size-ratio guardrail: simulate applying all groups and
// drop highest-numbered groups until newText.length / current.text.length ≤ 1.5.
// If even after all groups dropped the SINGLE remaining group exceeds 1.5×, the
// caller aborts with stopReason: 'article_size_explosion'.

import {
  AGENT_MAX_ATOMIC_EDITS_PER_CYCLE,
  AGENT_MAX_ATOMIC_EDITS_PER_GROUP,
  EDIT_NEWTEXT_LENGTH_CAP,
  SIZE_RATIO_HARD_CAP,
} from './constants';
import type { EditingGroup, EditingDroppedGroup, ValidateResult } from './types';

const RE_HEADING_LINE = /^#+ /m;
const RE_LIST_ITEM_LINE = /^[*+\-] /m;
const RE_HORIZONTAL_RULE = /^---\s*$/m;
const RE_CODE_FENCE = /```/;

function violatesHardRule(group: EditingGroup, currentText: string): string | null {
  if (group.atomicEdits.length > AGENT_MAX_ATOMIC_EDITS_PER_GROUP) {
    return `group_too_large_${group.atomicEdits.length}`;
  }
  for (const e of group.atomicEdits) {
    if (e.newText.length > EDIT_NEWTEXT_LENGTH_CAP) return 'newText_too_long';
    if (e.oldText.includes('\n\n')) return 'oldText_contains_paragraph_break';
    if (e.newText.includes('\n\n')) return 'newText_contains_paragraph_break';
    if (RE_CODE_FENCE.test(e.oldText) || RE_CODE_FENCE.test(e.newText)) return 'code_fence_in_edit';
    if (RE_HEADING_LINE.test(e.newText)) return 'newText_introduces_heading';
    if (RE_HORIZONTAL_RULE.test(e.newText)) return 'newText_introduces_horizontal_rule';
    // Range crossing checks: examine the slice of currentText covered by the edit.
    const span = currentText.slice(e.range.start, e.range.end);
    if (RE_HEADING_LINE.test(span)) return 'range_crosses_heading';
    if (RE_LIST_ITEM_LINE.test(span)) return 'range_crosses_list_boundary';
  }
  return null;
}

/** Conservative size-ratio simulation: assume all groups apply. */
function simulateNewTextLength(groups: EditingGroup[], currentTextLength: number): number {
  let delta = 0;
  for (const g of groups) {
    for (const e of g.atomicEdits) {
      delta += e.newText.length - e.oldText.length;
    }
  }
  return currentTextLength + delta;
}

export function validateEditGroups(
  groups: EditingGroup[],
  currentText: string,
): ValidateResult & { sizeExplosion: boolean } {
  const droppedPreApprover: EditingDroppedGroup[] = [];
  const survivors: EditingGroup[] = [];

  // Step 1: hard-rule check per group.
  for (const g of groups) {
    const violation = violatesHardRule(g, currentText);
    if (violation != null) {
      droppedPreApprover.push({ groupNumber: g.groupNumber, reason: violation });
    } else {
      survivors.push(g);
    }
  }

  // Step 2: cycle cap — drop excess groups in number order.
  let totalAtomic = survivors.reduce((sum, g) => sum + g.atomicEdits.length, 0);
  let cyclecapped = [...survivors];
  while (totalAtomic > AGENT_MAX_ATOMIC_EDITS_PER_CYCLE && cyclecapped.length > 0) {
    const dropped = cyclecapped.pop()!;
    droppedPreApprover.push({ groupNumber: dropped.groupNumber, reason: 'cycle_cap_exceeded' });
    totalAtomic -= dropped.atomicEdits.length;
  }

  // Step 3: size-ratio guardrail — drop highest-numbered groups until ratio ≤ 1.5×.
  // If even with zero groups the simulation would fail, the SINGLE remaining group
  // is a mega-insertion → caller aborts the cycle.
  const baseLen = currentText.length;
  let remaining = [...cyclecapped].sort((a, b) => a.groupNumber - b.groupNumber);
  let projectedLen = simulateNewTextLength(remaining, baseLen);
  while (projectedLen / baseLen > SIZE_RATIO_HARD_CAP && remaining.length > 0) {
    const dropped = remaining.pop()!;
    droppedPreApprover.push({ groupNumber: dropped.groupNumber, reason: 'size_ratio_guardrail' });
    projectedLen = simulateNewTextLength(remaining, baseLen);
  }
  // If a single mega-insertion would still exceed even with no other groups, flag.
  let sizeExplosion = false;
  if (remaining.length === 0 && cyclecapped.length > 0 && projectedLen / baseLen > SIZE_RATIO_HARD_CAP) {
    sizeExplosion = true;
  }

  return { approverGroups: remaining, droppedPreApprover, sizeExplosion };
}
