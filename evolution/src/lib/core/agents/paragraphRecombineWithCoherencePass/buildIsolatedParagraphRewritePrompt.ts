// paragraph_recombine_agent_with_coherence_pass_evolution_20260620.
//
// Per-paragraph rewrite prompt builder for the ISOLATED rewrite path (no priorPicks,
// no nextContext, no coordinator). The agent operates one paragraph at a time with
// zero cross-paragraph signal — matches the user's requirement "rewrite the paragraph
// inline with no other context".
//
// Three locked directives (Q3 from /research):
//   0. REORDER (temp 0.6) — reorder sentences for better logical flow; no new content.
//   1. TIGHTEN (temp 0.7) — remove redundancy; preserve all non-redundant content.
//   2. RESTRUCTURE (temp 1.0) — vary cadence, break/combine sentences; same information.
//
// Each directive re-states the no-new-content prohibitions explicitly (belt-and-suspenders
// with the system prompt). For M > 3, cycle mod-3.
//
// Distinct from `buildParagraphRewritePrompt.ts` (the existing ParagraphRecombineAgent's
// rewrite prompt with the "add ONE example" directive) — that one allows content-additive
// edits. This one forbids them entirely.

export type IsolatedRewriteDirective = 'REORDER' | 'TIGHTEN' | 'RESTRUCTURE';

/** Per-directive prompt text. Each carries the SPECIFIC prohibitions the user requested
 *  (no new definitions, metaphors, analogies, or examples). Belt-and-suspenders with the
 *  system prompt: prohibitions are repeated here AND in the system-role preamble below. */
export const ISOLATED_REWRITE_DIRECTIVES: readonly { name: IsolatedRewriteDirective; text: string }[] = [
  {
    name: 'REORDER',
    text: 'Reorder sentences within the paragraph for better logical flow. Same content, different sequence. Do not add new sentences, definitions, metaphors, analogies, or examples; do not remove any non-redundant content.',
  },
  {
    name: 'TIGHTEN',
    text: 'Tighten wording and remove redundancy. Express the same ideas in fewer words. Cut filler, hedge phrases, and duplicate content. Do not add new definitions, metaphors, analogies, or examples; do not delete any non-redundant information.',
  },
  {
    name: 'RESTRUCTURE',
    text: 'Restructure sentences for clarity. Break long sentences, combine short choppy ones, vary cadence. Keep the same information and the same level of detail. Do not add new definitions, metaphors, analogies, or examples; do not remove any non-redundant content.',
  },
] as const;

/** Resolve the directive for rewrite index N (cycles mod-3 for M > 3). */
export function getIsolatedRewriteDirective(index: number): { name: IsolatedRewriteDirective; text: string } {
  const dir = ISOLATED_REWRITE_DIRECTIVES[index % ISOLATED_REWRITE_DIRECTIVES.length];
  if (!dir) throw new Error(`getIsolatedRewriteDirective: index ${index} out of range`);
  return dir;
}

/**
 * Per-rewrite temperature ladder. Per-directive moderate (Q2 from /research):
 *   index 0 (REORDER): floor (default 0.6)
 *   index 1 (TIGHTEN): mid (default 0.7)
 *   index 2 (RESTRUCTURE): ceiling (default 1.0)
 *   index 3+ (cycle mod-3): same as 0/1/2 respectively
 *
 * Floor and ceiling are tunable per-iteration via `coherencePassRewriteTempFloor` /
 * `coherencePassRewriteTempCeiling` for staging re-tuning without a redeploy.
 *
 * Clamped to the model's `maxTemperature`. Returns `undefined` when the model rejects
 * temperature options (e.g. some reasoning models).
 */
export function isolatedRewriteTemperature(
  index: number,
  floor: number,
  ceiling: number,
  maxTemp: number | null | undefined,
): number | undefined {
  if (maxTemp === null) return undefined;
  const modIdx = index % 3;
  // Linear interp: idx 0 → floor, idx 1 → midpoint, idx 2 → ceiling.
  const base = modIdx === 0
    ? floor
    : modIdx === 1
      ? (floor + ceiling) / 2
      : ceiling;
  return typeof maxTemp === 'number' ? Math.min(base, maxTemp) : base;
}

/**
 * Build the rewrite prompt for a single paragraph in isolation. No priorPicks, no
 * nextContext, no surrounding paragraphs — only the paragraph itself plus the
 * article H1 title for minimal context. This matches the user's "rewrite the
 * paragraph inline with no other context" requirement.
 *
 * The hard character-count floor/ceiling mirrors the existing
 * `buildParagraphRewritePrompt` pattern (LLMs follow concrete numeric constraints
 * far better than ratio-of-length language).
 */
export function buildIsolatedParagraphRewritePrompt(
  parentH1: string,
  paragraphText: string,
  paragraphIndex: number,
  totalSlots: number,
  directive: { name: IsolatedRewriteDirective; text: string },
): string {
  const originalChars = paragraphText.length;
  const minChars = Math.ceil(0.85 * originalChars);
  const maxChars = Math.floor(1.20 * originalChars);

  return `You are rewriting a single paragraph from a larger article. Work on THIS
paragraph in isolation — you cannot see the others, and no cross-paragraph
context will be considered.

CONTEXT
  Article title: "${parentH1}"
  This is paragraph ${paragraphIndex + 1} of ${totalSlots}.

APPROACH FOR THIS REWRITE (${directive.name})
  ${directive.text}

ABSOLUTE RULES (violations are silently discarded)

  1. NO NEW CONTENT. Do NOT add any of the following to the paragraph:
     - New definitions of terms (especially if the original didn't define them)
     - New metaphors or analogies (even ones that "improve clarity")
     - New examples or anecdotes
     - New factual claims
     - New transitional commentary explaining what the paragraph does

  2. PRESERVE NON-REDUNDANT CONTENT. You may DELETE words, phrases, or sentences
     if they are redundant (saying the same thing twice). You may NOT delete
     content that carries unique information, even if you think it could be
     cut for brevity.

  3. LENGTH. The original paragraph is ${originalChars} characters. Your rewrite
     MUST be at least ${minChars} characters and at most ${maxChars} characters.
     Stay inside this window — rewrites outside it are silently discarded.

OUTPUT
  Plain prose only — no markdown, no preamble, no commentary. Just the
  rewritten paragraph.

ORIGINAL:

${paragraphText}

REWRITTEN:
`;
}
