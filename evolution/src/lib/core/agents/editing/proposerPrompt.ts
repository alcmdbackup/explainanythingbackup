// Mode A proposer system + user prompt builder. The proposer emits the FULL
// article verbatim with inline CriticMarkup edits — Mode B (the rewrite-mode
// counterpart) lives in proposerPromptRewrite.ts.

const SOFT_RULES = [
  'Preserve quotes, citations, and URLs exactly as they appear in the original.',
  'Do not introduce new headings or modify existing heading lines.',
  'Prefer one-sentence edits over multi-sentence rewrites.',
  'Do not edit text inside code fences (```).',
  'Preserve the author\'s voice, tone, and reading level.',
  'Edit only when the change demonstrably improves clarity, structure, engagement, or grammar — never for its own sake.',
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

const FAILURE_GALLERY = `Failure patterns observed on this exact task — avoid:

  PATTERN A — paraphrase outside markup (RULE 1 violation):
    Source:  "The cat sat on the mat. It purred softly."
    BAD:     "The {++ small ++}cat sat on a mat. It purred softly."
    GOOD:    "The {++ small ++}cat sat on the mat. It purred softly."
    (BAD changed "the mat" to "a mat" outside any markup span.)

  PATTERN B — old-side rephrased (RULE 2 violation):
    Source:  "The cat sat on the mat."
    BAD:     "{~~A cat sat on the mat~>The cat curled up on the mat~~}."
    GOOD:    "{~~The cat sat on the mat~>The cat curled up on the mat~~}."
    (BAD's old side starts with "A cat"; the source starts with "The cat".)`;

const WORKED_EXAMPLE = `Worked example (study the structure, not the topic):

  GIVEN this source article (provided to you in the user message inside
  <source>…</source> — do NOT echo it in your response):

    The product launched in March. Users liked it. Revenue grew quickly.

  YOUR RESPONSE — ONE <output>…</output> block, nothing else:

    <output>
    The product launched in March. {~~Users liked it.~>Early users gave it
    strong reviews.~~} Revenue grew{++ 40% quarter-over-quarter++} quickly.
    </output>

  Note: the first sentence is byte-identical. The substitution's old side
  ("Users liked it.") is copied verbatim from the source. The insertion sits
  between two source bytes ("grew" and " quickly") with no surrounding
  rewording.`;

const EDIT_BUDGET = `Edit budget: propose AT MOST 3 atomic edits per cycle.
An "atomic edit" is one CriticMarkup span or one adjacent group of spans
acting as a single change. Fewer surgical edits ship; sprawling rewrites
get discarded.`;

const SYNTAX_DOCS = `Use any of these CriticMarkup forms for each atomic edit:

  Insertion:                     {++ inserted text ++}
  Deletion:                      {-- deleted text --}
  Substitution (inline form):    {~~ old text ~> new text ~~}
  Substitution (paired form):    {~~ old text ~~}{++ new text ++}

Both substitution forms are accepted. The reviewer groups markup spans that are adjacent (separated only by whitespace, no paragraph break between) and accepts or rejects each group as one atomic unit. Place related edits next to each other; separate independent edits with a blank line.

You may optionally tag a span with [#N] (e.g. {++ [#1] ... ++}) to force grouping across non-adjacent spans. Most edits will not need this — the adjacency rule handles common cases.`;

const SELF_CHECK = `Self-check before responding (do this literally, not metaphorically):
  1. Mentally delete every {++…++} and the new-side of every {~~old~>new~~}.
  2. Mentally keep every {--…--} content and the old-side of every {~~old~>new~~}.
  3. The result must equal the text inside <source>…</source>, byte-for-byte
     (whitespace differences ok, word/punctuation differences NOT ok).
  4. If it doesn't match, fix your output before responding.`;

export function buildProposerSystemPrompt(): string {
  return [
    'You propose edits to an article. Your output is the FULL ARTICLE BODY VERBATIM with inline CriticMarkup edits.',
    '',
    HARD_CONSTRAINT,
    '',
    SYNTAX_DOCS,
    '',
    FAILURE_GALLERY,
    '',
    WORKED_EXAMPLE,
    '',
    EDIT_BUDGET,
    '',
    'Soft rules — follow these unless the edit demonstrably improves the article:',
    ...SOFT_RULES.map((r, i) => `  ${i + 1}. ${r}`),
    '',
    SELF_CHECK,
    '',
    'Output the <output>…</output> block ONLY. No commentary, no summary, no preamble, and no echo of the <source> block.',
  ].join('\n');
}

export function buildProposerUserPrompt(currentText: string): string {
  return `<source>\n${currentText}\n</source>\n\nReturn the article inside <output>…</output>.`;
}
