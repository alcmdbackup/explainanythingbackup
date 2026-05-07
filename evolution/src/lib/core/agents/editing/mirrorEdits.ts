// Mirror-edit helpers for the proposer/approver criteria agent's mirror-approver protocol.
//
// Mirror approach: the approver runs twice on each proposed edit group:
//   - Forward pass on (originalArticle, originalProposal)
//   - Mirror pass on (articleA' = original + applied forward edits, sign-flipped proposal)
// Aggregator: APPLY iff (forward=ACCEPT, mirror=REJECT). Strict binary; everything else drops.
//
// This module produces the inverted (mirror) edit groups + mirror article + mirror markup
// string for the mirror-approver call.
//
// Mirror transformation rules (applied to each atomic edit `e` in a forward group):
//   - insert {++ X ++} at P  →  delete X from [P, P+len(X)) in A'
//   - delete {-- Y --} at [s,e)  →  insert Y at [s, s) in A'
//   - replace {~~ X ~> Y ~~} at [s,e)  →  replace Y back to X at [s, s+len(Y)) in A'
//
// Position arithmetic: forward edits are applied right-to-left (highest range.start first)
// to avoid offset shift. To map an atomic edit's position from A → A', we need the cumulative
// length delta of all earlier-applied (i.e., higher-position) forward edits at sites > this edit's
// position. But because right-to-left application leaves lower positions stable, an edit at
// position P in A still lives at position P in A' AS LONG AS no other forward edit shifted it.
// Concretely: for edit i at position p_i, its position in A' is p_i + Σ(Δ_j) for all j where p_j < p_i.
// That's the offsets BELOW p_i. (Right-to-left application means BEFORE we apply edit i, all
// HIGHER-position edits have already shifted everything > their start; nothing below p_i has shifted yet.)

import type { EditingAtomicEdit, EditingGroup } from '../../../types';

const CONTEXT_LEN = 30;

/** String-splice utility. */
function spliceString(text: string, start: number, deleteCount: number, insertText: string): string {
  return text.slice(0, start) + insertText + text.slice(start + deleteCount);
}

/** Apply a single atomic edit to text, returning the result. Caller is responsible for
 *  ordering (right-to-left) when applying multiple edits. */
function applyAtomicEdit(text: string, e: EditingAtomicEdit): string {
  const span = e.range.end - e.range.start;
  return spliceString(text, e.range.start, span, e.newText);
}

/** Cumulative length delta of edits whose start < threshold (in original A coordinates).
 *  Used to map a position from A to A' (post-apply). */
function deltaBelow(edits: ReadonlyArray<EditingAtomicEdit>, threshold: number): number {
  let delta = 0;
  for (const e of edits) {
    if (e.range.start < threshold) {
      delta += e.newText.length - (e.range.end - e.range.start);
    }
  }
  return delta;
}

/** Apply a sequence of forward edits to article A → A'. Right-to-left order. */
export function applyEditsRTL(article: string, edits: ReadonlyArray<EditingAtomicEdit>): string {
  const sorted = [...edits].sort((a, b) => b.range.start - a.range.start);
  let text = article;
  for (const e of sorted) text = applyAtomicEdit(text, e);
  return text;
}

/** Invert a single atomic edit. The result is in A' coordinates (the article AFTER all forward
 *  edits in the group are applied). `allForwardEdits` is the full edit list of the group, used
 *  to compute the offset shift below this edit's position. */
export function invertAtomicEdit(
  edit: EditingAtomicEdit,
  articleAfterApply: string,
  allForwardEdits: ReadonlyArray<EditingAtomicEdit>,
): EditingAtomicEdit {
  const offsetShift = deltaBelow(allForwardEdits, edit.range.start);
  const newStart = edit.range.start + offsetShift;
  // For insert: original range was zero-width [P, P]; in A' it spans [P, P+len(newText)).
  // For delete: original range was [s, e), inserted nothing; in A' it's a zero-width gap at s.
  // For replace: original range was [s, e), replaced with newText; in A' it spans [s, s+len(newText)).
  let newRangeEnd: number;
  if (edit.kind === 'insert') {
    newRangeEnd = newStart + edit.newText.length;
  } else if (edit.kind === 'delete') {
    newRangeEnd = newStart; // zero-width gap (the insert site)
  } else { // replace
    newRangeEnd = newStart + edit.newText.length;
  }

  // Flip kind + swap texts.
  const flippedKind: EditingAtomicEdit['kind'] =
    edit.kind === 'insert' ? 'delete' :
    edit.kind === 'delete' ? 'insert' :
    'replace';

  const contextBefore = articleAfterApply.slice(Math.max(0, newStart - CONTEXT_LEN), newStart);
  const contextAfter = articleAfterApply.slice(newRangeEnd, Math.min(articleAfterApply.length, newRangeEnd + CONTEXT_LEN));

  return {
    groupNumber: edit.groupNumber,
    kind: flippedKind,
    range: { start: newStart, end: newRangeEnd },
    // markupRange is regenerated when we render the mirror markup string; placeholder here.
    markupRange: { start: 0, end: 0 },
    oldText: edit.newText, // swap
    newText: edit.oldText, // swap
    contextBefore,
    contextAfter,
  };
}

/** Construct a mirror group. Applies the group's forward edits to originalArticle to get A',
 *  then inverts each atomic edit with positions remapped into A' coordinates. */
export function constructMirrorGroup(
  group: EditingGroup,
  originalArticle: string,
): { mirrorGroup: EditingGroup; articleAfterApply: string } {
  const articleAfterApply = applyEditsRTL(originalArticle, group.atomicEdits);
  const mirrorAtomicEdits = group.atomicEdits.map((e) =>
    invertAtomicEdit(e, articleAfterApply, group.atomicEdits),
  );
  return {
    mirrorGroup: { groupNumber: group.groupNumber, atomicEdits: mirrorAtomicEdits },
    articleAfterApply,
  };
}

/** Verification helper: apply a group's atomic edits, then apply the inverse, expecting the
 *  original text. Used by property tests. Returns success + the round-trip article (should
 *  equal `article` on success). */
export function roundTripApply(
  group: EditingGroup,
  article: string,
): { success: boolean; finalText: string; failureReason?: string } {
  try {
    const { mirrorGroup, articleAfterApply } = constructMirrorGroup(group, article);
    const finalText = applyEditsRTL(articleAfterApply, mirrorGroup.atomicEdits);
    return {
      success: finalText === article,
      finalText,
      ...(finalText !== article && { failureReason: 'round-trip mismatch' }),
    };
  } catch (err) {
    return {
      success: false,
      finalText: '',
      failureReason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Render the mirror markup string — full mirror article (A') with inline CriticMarkup for
 *  each mirror edit group. Output suitable for feeding to the mirror-approver LLM. */
export function renderMirrorMarkup(
  originalArticle: string,
  forwardGroups: ReadonlyArray<EditingGroup>,
): { mirrorArticleA: string; mirrorMarkupString: string; mirrorGroups: EditingGroup[] } {
  // Apply ALL forward groups' edits to get A'.
  const allForwardEdits = forwardGroups.flatMap((g) => g.atomicEdits);
  const mirrorArticleA = applyEditsRTL(originalArticle, allForwardEdits);

  // Construct mirror groups against the FULL post-apply article (not per-group A's).
  const mirrorGroups: EditingGroup[] = forwardGroups.map((g) => {
    const mirrorAtomic = g.atomicEdits.map((e) =>
      invertAtomicEdit(e, mirrorArticleA, allForwardEdits),
    );
    return { groupNumber: g.groupNumber, atomicEdits: mirrorAtomic };
  });

  // Render the markup string by walking mirrorArticleA right-to-left and inserting CriticMarkup
  // around each mirror edit's range.
  let mirrorMarkupString = mirrorArticleA;
  // Sort all atomic edits across all groups by range.start descending so we splice from the end.
  const allMirrorEdits = mirrorGroups.flatMap((g) =>
    g.atomicEdits.map((e) => ({ ...e, gNum: g.groupNumber })),
  ).sort((a, b) => b.range.start - a.range.start);

  for (const e of allMirrorEdits) {
    let markup: string;
    if (e.kind === 'insert') {
      markup = `{++ [#${e.gNum}] ${e.newText} ++}`;
      mirrorMarkupString = spliceString(mirrorMarkupString, e.range.start, 0, markup);
    } else if (e.kind === 'delete') {
      const span = e.range.end - e.range.start;
      const deleted = mirrorMarkupString.slice(e.range.start, e.range.end);
      markup = `{-- [#${e.gNum}] ${deleted} --}`;
      mirrorMarkupString = spliceString(mirrorMarkupString, e.range.start, span, markup);
    } else { // replace
      const span = e.range.end - e.range.start;
      const oldChunk = mirrorMarkupString.slice(e.range.start, e.range.end);
      markup = `{~~ [#${e.gNum}] ${oldChunk} ~> ${e.newText} ~~}`;
      mirrorMarkupString = spliceString(mirrorMarkupString, e.range.start, span, markup);
    }
  }

  return { mirrorArticleA, mirrorMarkupString, mirrorGroups };
}
