// Pre-Approver hard-rule validator. Applies group-level coherence: any atomic
// edit in a group fails any rule → the WHOLE group is dropped. Plus per-cycle
// and per-group caps.
//
// Rules enforced:
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
  SIZE_RATIO_HARD_CAP,
} from './constants';
import type { EditingGroup, EditingDroppedGroup, ValidateResult } from './types';
import { checkSemanticOverlap } from './checkSemanticOverlap';

const RE_HEADING_LINE = /^#+ /m;
const RE_LIST_ITEM_LINE = /^[*+\-] /m;
const RE_HORIZONTAL_RULE = /^---\s*$/m;
const RE_CODE_FENCE = /```/;
/** Transition words at paragraph starts — preserving these maintains article flow.
 *  Used by the flow guardrail (proposer/approver criteria agent only). */
const RE_TRANSITION_START = /^(However|Therefore|Thus|Moreover|Furthermore|In contrast|Similarly|Conversely|Nevertheless|Specifically|For example|In other words|As a result|Ultimately),?\s/i;

/** Default length cap for the new propose/approve criteria agent — much tighter than the
 *  legacy 1.5× cap so the +/-10% length-preservation directive has structural backing. */
export const DEFAULT_LENGTH_CAP_RATIO = 1.10;

export interface ValidateEditGroupsOptions {
  /** Override SIZE_RATIO_HARD_CAP (1.5×) with a tighter ratio (e.g. 1.10× for propose/approve). */
  lengthCapRatio?: number;
  /** When set, edits whose newText shares more than this fraction of trigrams with the rest
   *  of the article (article minus old range) are dropped as redundant. undefined disables. */
  redundancyJaccardThreshold?: number;
  /** When true, edits at paragraph-start that delete or replace a transition word are dropped. */
  flowGuardrailEnabled?: boolean;
}

function violatesHardRule(
  group: EditingGroup,
  currentText: string,
  opts?: ValidateEditGroupsOptions,
): string | null {
  if (group.atomicEdits.length > AGENT_MAX_ATOMIC_EDITS_PER_GROUP) {
    return `group_too_large_${group.atomicEdits.length}`;
  }
  for (const e of group.atomicEdits) {
    if (e.oldText.includes('\n\n')) return 'oldText_contains_paragraph_break';
    if (e.newText.includes('\n\n')) return 'newText_contains_paragraph_break';
    if (RE_CODE_FENCE.test(e.oldText) || RE_CODE_FENCE.test(e.newText)) return 'code_fence_in_edit';
    if (RE_HEADING_LINE.test(e.newText)) return 'newText_introduces_heading';
    if (RE_HORIZONTAL_RULE.test(e.newText)) return 'newText_introduces_horizontal_rule';
    // Range crossing checks: examine the slice of currentText covered by the edit.
    const span = currentText.slice(e.range.start, e.range.end);
    if (RE_HEADING_LINE.test(span)) return 'range_crosses_heading';
    if (RE_LIST_ITEM_LINE.test(span)) return 'range_crosses_list_boundary';
    // Flow guardrail (opt-in): edit at paragraph start that deletes/replaces a transition word.
    if (opts?.flowGuardrailEnabled) {
      // Check if range starts immediately after a paragraph break (or at article start).
      const charBefore = e.range.start === 0 ? '\n' : currentText[e.range.start - 1];
      if (charBefore === '\n' && RE_TRANSITION_START.test(e.oldText.trim())) {
        // The edit removes/replaces a transition phrase. If newText doesn't preserve a transition, drop.
        if (e.kind === 'delete' || (e.kind === 'replace' && !RE_TRANSITION_START.test(e.newText.trim()))) {
          return 'flow_transition_violation';
        }
      }
    }
    // Redundancy guardrail (opt-in): newText shares too many trigrams with rest of article.
    if (opts?.redundancyJaccardThreshold !== undefined && e.newText.length >= 30) {
      const result = checkSemanticOverlap(e.newText, currentText, e.range, opts.redundancyJaccardThreshold);
      if (result.exceeds) return 'semantic_overlap_with_existing_content';
    }
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
  opts?: ValidateEditGroupsOptions,
): ValidateResult & { sizeExplosion: boolean } {
  const droppedPreApprover: EditingDroppedGroup[] = [];
  const survivors: EditingGroup[] = [];
  const lengthCapRatio = opts?.lengthCapRatio ?? SIZE_RATIO_HARD_CAP;

  // Step 1: hard-rule check per group.
  for (const g of groups) {
    const violation = violatesHardRule(g, currentText, opts);
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
  // sizeExplosion fires when the guardrail had to drop a mega-insertion: a single
  // group whose net inflation alone exceeds 0.5×baseLen (i.e., applying it would
  // push the article past the 1.5× hard cap on its own). The mega-insertion case
  // is the proposer ignoring the soft "one-sentence edits preferred" rule by a
  // wide margin — the cycle should abort rather than silently drop.
  const baseLen = currentText.length;
  let remaining = [...cyclecapped].sort((a, b) => a.groupNumber - b.groupNumber);
  let projectedLen = simulateNewTextLength(remaining, baseLen);

  let sizeExplosion = false;
  while (projectedLen / baseLen > lengthCapRatio && remaining.length > 0) {
    const dropped = remaining.pop()!;
    droppedPreApprover.push({ groupNumber: dropped.groupNumber, reason: 'size_ratio_guardrail' });
    // Mega-insertion check: if THIS dropped group's net inflation alone exceeds
    // the cap, flag explosion so the agent aborts the cycle (proposer was wildly
    // over-aggressive — silent drop would mask the signal).
    const groupInflation = dropped.atomicEdits.reduce(
      (sum, e) => sum + e.newText.length - e.oldText.length, 0,
    );
    if (groupInflation > baseLen * (lengthCapRatio - 1)) {
      sizeExplosion = true;
    }
    projectedLen = simulateNewTextLength(remaining, baseLen);
  }

  return { approverGroups: remaining, droppedPreApprover, sizeExplosion };
}
