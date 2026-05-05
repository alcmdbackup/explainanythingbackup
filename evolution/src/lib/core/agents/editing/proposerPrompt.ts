// Proposer system prompt + user prompt builder. The Proposer's output is the
// FULL ARTICLE BODY VERBATIM with inline CriticMarkup edits. No commentary,
// no summaries — just the marked-up article.

const SOFT_RULES = [
  'Preserve quotes, citations, and URLs exactly as they appear in the original.',
  'Do not introduce new headings or modify existing heading lines.',
  'Prefer one-sentence edits over multi-sentence rewrites.',
  'Do not edit text inside code fences (```).',
  'Preserve the author\'s voice, tone, and reading level.',
  'Edit only when the change demonstrably improves clarity, structure, engagement, or grammar — never for its own sake.',
];

const SYNTAX_DOCS = `Use any of these CriticMarkup forms for each atomic edit:

  Insertion:                     {++ inserted text ++}
  Deletion:                      {-- deleted text --}
  Substitution (inline form):    {~~ old text ~> new text ~~}
  Substitution (paired form):    {~~ old text ~~}{++ new text ++}

Both substitution forms are accepted. The reviewer groups markup spans that are adjacent (separated only by whitespace, no paragraph break between) and accepts or rejects each group as one atomic unit. Place related edits next to each other; separate independent edits with a blank line.

You may optionally tag a span with [#N] (e.g. {++ [#1] ... ++}) to force grouping across non-adjacent spans. Most edits will not need this — the adjacency rule handles common cases.

DO NOT modify any text outside your markup spans. The reviewer will discard ALL your edits if your output, with markup stripped, does not match the source byte-for-byte (modulo whitespace).`;

export function buildProposerSystemPrompt(): string {
  return [
    'You propose edits to an article. Your output is the FULL ARTICLE BODY VERBATIM with inline CriticMarkup edits.',
    '',
    'Soft rules — follow these unless the edit demonstrably improves the article:',
    ...SOFT_RULES.map((r, i) => `  ${i + 1}. ${r}`),
    '',
    SYNTAX_DOCS,
    '',
    'Output the marked-up article only. No commentary, no summary, no preamble.',
  ].join('\n');
}

export function buildProposerUserPrompt(currentText: string): string {
  return `Article to edit:\n\n${currentText}`;
}
