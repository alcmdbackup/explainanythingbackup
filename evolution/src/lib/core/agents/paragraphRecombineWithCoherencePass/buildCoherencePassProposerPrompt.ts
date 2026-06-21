// paragraph_recombine_agent_with_coherence_pass_evolution_20260620 Phase 4.
//
// Coherence-pass proposer prompt. Fork of editing/proposerPrompt.ts with inter-paragraph-seam
// focus instead of generic article editing.
//
// The coherence pass operates on the RECOMBINED article (winners of M parallel paragraph
// rewrites that were judged in isolation, with no cross-paragraph signal). The seams between
// paragraphs may be rough: transitions broken, pronouns referring to the wrong antecedent,
// duplicate phrasing repeated across paragraphs, voice/tone discontinuities. The pass's
// JOB is to smooth those seams with MINOR edits.
//
// Differences from the generic editing/proposerPrompt.ts:
//   - Scope guidance directs the proposer at inter-paragraph seams specifically
//   - Edit budget is tighter (1-3 edits per group max — conservative smoothing only)
//   - Hard size-ratio reminder (the per-iteration validateOpts caps growth at 1.02×;
//     the prompt nudges the proposer to stay well inside that cap)
//
// The byte-equality contracts (RULE 1 outside-markup fidelity, RULE 2 old-side fidelity)
// are preserved verbatim from the parent prompt — they are non-negotiable for any
// CriticMarkup-emitting proposer.

const COHERENCE_SOFT_RULES = [
  'Preserve quotes, citations, and URLs exactly as they appear.',
  'Do not introduce new headings or modify existing heading lines.',
  'Do not edit text inside code fences (```).',
  'Preserve the author\'s voice, tone, and reading level.',
  'Edit ONLY for inter-paragraph smoothing — transitions between paragraphs, pronoun resolution across paragraph boundaries, deduping phrases repeated across paragraphs. Do NOT improve individual paragraphs in isolation (they were already judged on quality).',
];

const HARD_CONSTRAINT = `HARD CONSTRAINT — read twice before writing.

Your response contains EXACTLY ONE thing: an <output>…</output> block. Inside
that block, reproduce the source article CHARACTER-FOR-CHARACTER, with your
edits expressed ONLY through inline CriticMarkup. Do NOT echo the <source>
block in your response — the source is given to you in the user message
solely for reference; your response only contains <output>…</output>.

Two byte-equality rules apply to the contents of <output>. Violating either
causes ALL your edits to be discarded:

  RULE 1 (outside-markup fidelity): every byte OUTSIDE a {++…++}, {--…--}, or
  {~~…~~} span must match the source verbatim — same words, same punctuation,
  same spacing.

  RULE 2 (old-side fidelity): the "old" side of every {~~old~>new~~} (or paired
  {~~old~~}{++new++}) must be COPIED from the source. Do not rephrase, normalize,
  or "clean up" the old side. If you wouldn't quote it that way under oath, don't
  put it in old.`;

const SCOPE_GUIDANCE = `SCOPE — you are smoothing the SEAMS between paragraphs.

The article you are reviewing was assembled by combining paragraphs that were
rewritten INDEPENDENTLY in parallel. Each individual paragraph has already been
judged for quality; do NOT try to improve them on their own merits. Focus
EXCLUSIVELY on inter-paragraph issues:

  - TRANSITIONS — does each paragraph flow naturally from the previous one? If
    a transition phrase ("However," "Therefore," "In contrast,") would help
    bridge two paragraphs, add it. If a paragraph starts abruptly without
    referring back to what came before, smooth the opening sentence.

  - PRONOUN RESOLUTION — does a pronoun in paragraph N+1 refer clearly to
    something named in paragraph N? If "it" or "they" or "this" is ambiguous
    across the seam, replace it with the named referent.

  - DEDUPLICATION — do two adjacent paragraphs explain the same idea twice
    (because each independent rewriter included the same context)? If so, cut
    the redundant explanation from the SECOND paragraph (keep the first occurrence).

  - VOICE/TONE CONTINUITY — if paragraph N+1 abruptly shifts register (formal
    vs. casual, technical vs. accessible), gently adjust the opening to bridge.

NOT YOUR JOB: rewriting whole paragraphs, fixing within-paragraph clarity,
adding new examples or analogies, improving the article's overall structure.`;

const SYNTAX_DOCS = `Use any of these CriticMarkup forms for each atomic edit:

  Insertion:                     {++ inserted text ++}
  Deletion:                      {-- deleted text --}
  Substitution (inline form):    {~~ old text ~> new text ~~}
  Substitution (paired form):    {~~ old text ~~}{++ new text ++}

Both substitution forms are accepted.`;

const EDIT_BUDGET = `Edit budget: propose AT MOST 5 atomic edits total, with 1-3 edits per
adjacent group. Coherence-pass edits should be MINOR — a transition word here,
a pronoun replacement there. Sprawling rewrites get discarded by the downstream
size-ratio validator (cap: +2% article length).`;

const SELF_CHECK = `Self-check before responding:
  1. Mentally delete every {++…++} and the new-side of every {~~old~>new~~}.
  2. Mentally keep every {--…--} content and the old-side of every {~~old~>new~~}.
  3. The result must equal the text inside <source>…</source>, byte-for-byte.
  4. If it doesn't match, fix your output before responding.`;

export function buildCoherencePassProposerSystemPrompt(): string {
  return [
    'You smooth the inter-paragraph seams of an article whose paragraphs were rewritten independently and recombined. Your output is the FULL ARTICLE BODY VERBATIM with inline CriticMarkup edits.',
    '',
    HARD_CONSTRAINT,
    '',
    SCOPE_GUIDANCE,
    '',
    SYNTAX_DOCS,
    '',
    EDIT_BUDGET,
    '',
    'Soft rules — follow these unless the edit demonstrably improves inter-paragraph flow:',
    ...COHERENCE_SOFT_RULES.map((r, i) => `  ${i + 1}. ${r}`),
    '',
    SELF_CHECK,
    '',
    'Output the <output>…</output> block ONLY. No commentary, no preamble.',
  ].join('\n');
}

export function buildCoherencePassProposerUserPrompt(recombinedArticle: string): string {
  return `<source>\n${recombinedArticle}\n</source>\n\nReturn the article inside <output>…</output> with inter-paragraph-seam smoothing edits in CriticMarkup.`;
}
