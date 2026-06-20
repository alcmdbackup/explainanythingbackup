// Phase A coordinator prompt builder. The coordinator reads the parent article + paragraph
// count and emits a per-paragraph plan with M strategically-diverse variation directives
// per paragraph. No structured analogy/acronym/voice fields — coordinator embeds article-
// level intent directly in directive text. See debug_performance_paragraph_recombine_20260612
// planning doc for the full design.
//
// investigate_sequential_paragraph_recombine_performance_20260615 Phase 2a + 1b-ii:
// extracted the strategies/temperature/skip/diversity guidance into the shared
// COORDINATOR_STRATEGIES_BLOCK const so both the initial coordinator prompt (this file)
// and the replan prompt (buildCoordinatorReplanPrompt.ts) interpolate the SAME text.
// Single source of truth — do NOT inline-edit a duplicate. The WHEN TO SKIP subsection
// was strengthened in Phase 1b-ii with concrete heuristics + an explicit target rate
// (2-4 of 8-12 slots) to address the "no-op rewrite" failure mode where the coordinator
// marked shouldRewrite=true for paragraphs whose rewrites turned out near-duplicates
// of the seed (e.g. slot 4 of 623a5d48: rewrite changed "In its capacity as" to "As a"
// then lost +111 Elo to the seed). Strengthened guidance pushes the LLM toward more
// conservative skip behavior.

/**
 * Shared strategies / temperature / skip / diversity guidance block.
 *
 * LOAD-BEARING — both `buildCoordinatorPrompt` (initial plan) AND
 * `buildCoordinatorReplanPrompt` (mid-sequence replan) interpolate this const so
 * the two prompts cannot drift. If a strategy is added or removed, EVERY coordinator
 * call inherits the change automatically.
 *
 * Do NOT inline-edit the duplicate text in either caller — edit this const.
 */
export const COORDINATOR_STRATEGIES_BLOCK = `AIM FOR DIVERSITY OF STRATEGIES across the M variations for a single paragraph. The M
directives should attack the rewrite from meaningfully different angles — NOT three
near-duplicate instructions. The downstream judge picks the best of M; you maximize its
chances of finding a good one by giving it genuinely different options.

EXAMPLE STRATEGIES PER ROLE:

Lede (paragraph 0, no prior picks yet):
  - Anchor with one controlling metaphor
  - Concrete narrative opening
  - Stakes-first framing
  - Counterintuitive-claim opener
  - Question-led entry

Body paragraphs (will see all prior picks):
  - Tighten and preserve fact density
  - Add a concrete example or sensory detail
  - Polish flow + transition from the previous paragraph
  - Reframe in plainer vocabulary
  - Compress to a single load-bearing point
  - Expand with parallel structure

Closers:
  - Forward-look framing
  - Synthesis recap (without restating earlier metaphors)
  - Open question
  - Tactical summary

DO NOT write "tighten" + "tighten more aggressively" + "tighten with examples" — that's
three slight variants of the same strategy. Better: "tighten" + "add concrete example"
+ "polish flow" — three meaningfully different angles.

DO NOT prescribe numeric voice targets (Latinate ratio, sentence-length numerics,
contractions-per-1k). The downstream LLM reads PRIOR CONTEXT directly and mirrors
voice naturally — distilled-numeric features are weaker signal than the prose itself.

TEMPERATURE GUIDANCE:
- Conservative/preserve directives ("tighten", "preserve concretion", "light copy-edit"): 0.7
- Polish/flow directives ("improve cadence", "smooth transitions"): 0.9
- Generative directives ("add an example", "synthesize"): 1.0-1.2
- AVOID temperatures above 1.4 — high-temp rewrites are unreliable.

WHEN TO SKIP A PARAGRAPH (shouldRewrite: false):

Default to skip when ANY of these hold — the goal is to spend rewrite budget on slots with real upside, not on near-duplicate cosmetic edits:

- HIGH FACT DENSITY: the paragraph packs 4+ specific entities (acronyms, proper nouns, dates, numbers, technical terms) per 100 words. Compressing risks dropping facts; expanding adds padding. Examples: a paragraph defining 3 acronyms in sequence; a paragraph listing 5 concrete steps.
- DEFINITIONAL ANCHOR: the paragraph introduces a core concept the rest of the article references by name. Paraphrasing the anchor breaks the article's internal grip on its own terminology.
- ALREADY-TIGHT PROSE: every sentence carries new information; nothing is filler; voice is consistent. Three rewrite attempts at varied temperatures will land within 5% verbatim of the original — wasted budget.
- SHORT PARAGRAPH (< 400 characters): rewriting short paragraphs tends to pad them; you rarely tighten further.
- RHETORICAL ANCHOR: the paragraph is the article's emotional or thematic pivot (a one-line punch closing the lede; a quoted figure; a transition that the rest of the article echoes).

When in doubt, prefer shouldRewrite: false. A skipped paragraph that the article-judge would have improved is a smaller loss than 3 wasted rewrites + 3 judge comparisons whose lift is below noise.

TARGET RATE: across a typical 8–12 paragraph article, expect 2–4 slots marked shouldRewrite: false. If you mark 0 or 1, you are under-skipping; if you mark 6+, you are giving up on the agent.

EMBEDDING ARTICLE-LEVEL INTENT INTO DIRECTIVES:

You may identify article-level concerns while reading (acronyms that should be defined
once and reused; an analogy budget you want to enforce; a controlling metaphor for the
lede). Embed those concerns directly into the relevant paragraphs' directive text. For
example:
  - "Introduce the Federal Open Market Committee (FOMC) on first use here."
  - "FOMC has been defined upstream — use the acronym alone here."
  - "Add one concrete analogy ONLY if the article doesn't have one yet."
  - "Do NOT introduce any new analogy in this paragraph."

The runtime does not parse these concerns out of your output — they take effect by
appearing as instructions in the directive that drives generation.`;

export type BuildCoordinatorPromptOptions = {
  parentText: string;
  paragraphCount: number;
};

export function buildCoordinatorPrompt(opts: BuildCoordinatorPromptOptions): string {
  const { parentText, paragraphCount } = opts;

  return `You are an article coordinator. Read the parent article and produce a plan for
rewriting it paragraph-by-paragraph. Your plan drives an automated pipeline that will
generate 1-3 rewrite candidates per paragraph IN SEQUENCE — each paragraph's variations
will see every previously-chosen paragraph as PRIOR CONTEXT, so candidates naturally
mirror the voice, register, cadence, and discipline of what came before.

PARENT ARTICLE has ${paragraphCount} body paragraphs.

YOUR JOB: for each of the ${paragraphCount} paragraphs, output a plan with:
1. role: one of 'lede', 'body', 'closer', 'sub_opener', 'technical_dense', 'header'
2. shouldRewrite: true OR false (skip strong paragraphs that need no work)
3. priority: 'high' | 'medium' | 'low'
4. M: 1, 2, or 3 (how many variation candidates to generate)
5. candidates: array of M objects, each with a custom directive + temperature
6. rationale: one sentence on why this allocation

${COORDINATOR_STRATEGIES_BLOCK}

OUTPUT FORMAT — return JSON, no markdown, no preamble, no commentary:
{
  "paragraphPlans": [
    {
      "paragraphIndex": 0,
      "role": "lede",
      "shouldRewrite": true,
      "priority": "high",
      "M": 3,
      "candidates": [
        { "directive": "<custom directive 1>", "temperature": 0.7 },
        { "directive": "<custom directive 2>", "temperature": 0.9 },
        { "directive": "<custom directive 3>", "temperature": 1.1 }
      ],
      "rationale": "<one sentence>"
    }
    // ...  exactly ${paragraphCount} entries total ...
  ]
}

PARENT ARTICLE:

${parentText}`;
}
