// Per-paragraph rewrite prompt builder. Per D12 of rank_individual_paragraphs_evolution_20260525.
// Three guardrails: preserve meaning in spirit, first/last sentences extra care, length ±20%.
//
// investigate_matchmaking_paragraph_recombine_20260528: the M rewrites per slot were produced
// from an IDENTICAL prompt, yielding quality-equivalent paraphrases that the judge could not
// rank (≈98% draws → per-slot Elo stuck at 1200). Each rewrite now receives a DISTINCT
// per-index `directive` (a transformation axis) so the rewrites differ on a real quality
// dimension, giving the judge signal to discriminate.

/**
 * Per-rewrite transformation directives (Option A — generation diversity). Cycled across the
 * M rewrites via `DIRECTIVES[index % length]`. Kept paragraph-scoped (NOT reusing the
 * article/section-scoped `SYSTEM_GENERATE_TACTICS`, whose "restructure sections / add headings"
 * directives would routinely trip the paragraph format + ±20% length gates).
 *
 * The content-additive directive (index 1) is deliberately capped at ONE sentence so it stays
 * within `validateParagraphRewrite`'s ±20% length window.
 */
export const PARAGRAPH_REWRITE_DIRECTIVES: readonly string[] = [
  // 0 — meaning-preserving, structural: trims toward a tighter, plainer version.
  'Tighten and simplify. Cut padding, hedging, and redundant phrasing; prefer plain words and shorter sentences. Do NOT add new information.',
  // 1 — content-additive (ONE sentence, to respect the ±20% length cap).
  'Add exactly ONE concise concrete example or analogy (a single sentence) that reinforces the existing point. Keep the underlying claim unchanged.',
  // 2 — style / flow: same information, better cadence.
  'Improve flow and rhythm. Vary sentence length, smooth the transitions between sentences, and strengthen the cadence. Keep the same information.',
];

/**
 * Build the prompt for a single per-paragraph rewrite call.
 *
 * Per the 3-guardrail design (D12):
 *  1. PRESERVE MEANING — underlying claims and conclusions intact; new examples/
 *     analogies/supporting details are fine if they REINFORCE the original point.
 *  2. FIRST AND LAST SENTENCES — rewrites OK but extra careful (transitions to
 *     neighboring paragraphs the rewriter can't see).
 *  3. LENGTH WITHIN ±20% — total character count must stay within 20% of original.
 *
 * Length cap is ALSO enforced via code in validateParagraphRewrite (the per-paragraph
 * gate in Phase 3). Prompt + code form belt-and-suspenders defense.
 *
 * When `directive` is provided, an "APPROACH FOR THIS REWRITE" block is injected so each
 * of the M parallel rewrites pursues a distinct transformation (see PARAGRAPH_REWRITE_DIRECTIVES).
 * The param is optional/defaulted so the single existing caller and tests still compile.
 */
export function buildParagraphRewritePrompt(
  parentH1: string,
  paragraphText: string,
  paragraphIndex: number,
  totalSlots: number,
  directive?: string,
): string {
  const approachBlock = directive
    ? `APPROACH FOR THIS REWRITE
  ${directive}

`
    : '';
  return `You are rewriting a single paragraph from a larger article. Express the same
meaning more clearly or fluently.

CONTEXT
  Article title: "${parentH1}"
  This is paragraph ${paragraphIndex + 1} of ${totalSlots}. You will not see the
  others; rewrites happen in parallel and the splice must read as one piece.

${approachBlock}RULES (violations are silently discarded)

  1. PRESERVE MEANING. Keep the paragraph's underlying claims and conclusions
     intact. New examples, analogies, or supporting details are fine as long
     as they reinforce — not change — the original point.

  2. FIRST AND LAST SENTENCES. Rewrites are OK, but be extra careful —
     these often carry transitions to neighboring paragraphs you can't see.

  3. LENGTH WITHIN ±20%. Total character count must stay within 20% of the
     original.

OUTPUT
  Plain prose only — no markdown, no preamble, no commentary. Just the
  rewritten paragraph.

ORIGINAL:

${paragraphText}

REWRITTEN:
`;
}
