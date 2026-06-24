// Mode A proposer system + user prompt builder. The proposer emits the FULL
// article verbatim with inline CriticMarkup edits — Mode B (the rewrite-mode
// counterpart) lives in proposerPromptRewrite.ts.

const PRESERVATION_RULES = [
  'Preserve quotes, citations, and URLs exactly as they appear in the original.',
  'Do not introduce new headings or modify existing heading lines.',
  'Do not edit text inside code fences (```).',
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

const SYNTAX_DOCS = `CriticMarkup forms:

  Insertion:                     {++ inserted text ++}
  Deletion:                      {-- deleted text --}
  Substitution (inline form):    {~~ old text ~> new text ~~}
  Substitution (paired form):    {~~ old text ~~}{++ new text ++}

Each CriticMarkup span is ONE independent edit. The reviewer accepts or
rejects each span on its own merits. The only exception is the paired
substitution form \`{~~ old ~~}{++ new ++}\` — an immediately-adjacent
delete+insert pair with no source characters between them is treated as one
substitution edit. Do not bundle unrelated edits together: maximize the
number of independent decisions you give the reviewer.

You may optionally tag a span with [#N] (e.g. {++ [#1] ... ++}) to force grouping across non-adjacent spans, where N is a POSITIVE INTEGER (1, 2, 3, …). Tags like [#0] or [#-1] are silently dropped. Most edits will not need this — each unnumbered span is already its own group by default.`;

const AMBITIOUS_DIRECTIVE = `Propose whatever edits you judge will most improve the article — large
structural rewrites, sentence-order swaps, many minor polish edits, or any
mix. Be ambitious. There is no edit budget and no preference for small vs.
large edits. The reviewer independently vets each edit, so the cost of
proposing a marginal one is low and the cost of withholding a useful one is
high. If a paragraph could be substantially better, rewrite the whole
paragraph in one substitution; if a single word is wrong, fix it. Propose
both ends of that spectrum freely.`;

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
    AMBITIOUS_DIRECTIVE,
    '',
    'Preservation rules — keep the article structurally intact:',
    ...PRESERVATION_RULES.map((r, i) => `  ${i + 1}. ${r}`),
    '',
    SELF_CHECK,
    '',
    'Output the <output>…</output> block ONLY. No commentary, no summary, no preamble, and no echo of the <source> block.',
  ].join('\n');
}

export function buildProposerUserPrompt(currentText: string): string {
  return `<source>\n${currentText}\n</source>\n\nReturn the article inside <output>…</output>.`;
}
