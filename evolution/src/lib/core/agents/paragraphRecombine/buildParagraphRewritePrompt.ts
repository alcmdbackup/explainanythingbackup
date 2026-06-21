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
 *
 * The tighten directive (index 0) carries an explicit LOWER-length floor: without it, "prefer
 * shorter sentences" reliably underflowed the 0.8× floor (89% length_under drop rate on slot
 * index 0 — investigate_paragraph_recombine_invocation_20260529), leaving slots with one surviving
 * rewrite. It must trim wordiness WITHOUT dropping below ~0.85× the original length.
 */
export const PARAGRAPH_REWRITE_DIRECTIVES: readonly string[] = [
  // 0 — meaning-preserving, structural: trims toward a tighter, plainer version (with a length floor).
  'Tighten and simplify. Cut padding, hedging, and redundant phrasing; prefer plain words and shorter sentences. Do NOT add new information. Keep the result within the ±20% length window — never below ~0.85x the original length: trim wordiness, do not delete substance or drop whole sentences.',
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
 *
 * I3a (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529): instead of
 * the vague "~0.85x" ratio in the rule-3 wording, inject a HARD CHARACTER COUNT computed
 * from the actual paragraph length. LLMs are notoriously poor at ratio-of-length
 * arithmetic but follow explicit character-count constraints far better. Pre-I3a the
 * post-fix invocations showed index-0 length_under drop rates of 92–100% with outputs
 * landing at 0.50–0.74 of original (mean 0.67) — well below the 0.8 validator floor.
 * The hard char-count below pegs the floor to `ceil(0.85 × paragraphText.length)` so
 * the LLM sees a concrete target. Belt-and-suspenders: the validator still enforces 0.8.
 */
export function buildParagraphRewritePrompt(
  parentH1: string,
  paragraphText: string,
  paragraphIndex: number,
  totalSlots: number,
  directive?: string,
  // generate_enforce_style_fingerprint_evolution_20260620: PARAGRAPH-shaped target style
  // (trailing optional ⇒ the promptEditor co-caller stays compiling + un-steered).
  styleGuide?: string,
): string {
  const originalChars = paragraphText.length;
  const minChars = Math.ceil(0.85 * originalChars);
  const maxChars = Math.floor(1.20 * originalChars);
  const approachBlock = directive
    ? `APPROACH FOR THIS REWRITE
  ${directive}

`
    : '';
  const styleBlock = styleGuide
    ? `TARGET STYLE
  ${styleGuide}

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

  3. LENGTH. The original paragraph is ${originalChars} characters. Your rewrite
     MUST be at least ${minChars} characters and at most ${maxChars} characters.
     Stay inside this window — rewrites outside it are silently discarded.

${styleBlock}OUTPUT
  Plain prose only — no markdown, no preamble, no commentary. Just the
  rewritten paragraph.

ORIGINAL:

${paragraphText}

REWRITTEN:
`;
}
