// Per-paragraph rewrite prompt builder. Per D12 of rank_individual_paragraphs_evolution_20260525.
// Three guardrails: preserve meaning in spirit, first/last sentences extra care, length ±20%.

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
 */
export function buildParagraphRewritePrompt(
  parentH1: string,
  paragraphText: string,
  paragraphIndex: number,
  totalSlots: number,
): string {
  return `You are rewriting a single paragraph from a larger article. Express the same
meaning more clearly or fluently.

CONTEXT
  Article title: "${parentH1}"
  This is paragraph ${paragraphIndex + 1} of ${totalSlots}. You will not see the
  others; rewrites happen in parallel and the splice must read as one piece.

RULES (violations are silently discarded)

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
