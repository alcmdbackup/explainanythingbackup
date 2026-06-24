// Mode B (iterative_editing_rewrite) proposer prompts. The proposer emits a
// short rationale block + a fully rewritten article body — NOT inline
// CriticMarkup. The agent then mechanically computes the markup via
// computeMarkupFromRewrite. Mode A counterpart lives in proposerPrompt.ts.

const PRESERVATION_RULES = [
  'Preserve quotes, citations, and URLs exactly as they appear in the original.',
  'Do not introduce new headings or modify existing heading lines.',
  'Do not edit text inside code fences (```).',
];

const FORMAT_SPEC = `Output format — respond with EXACTLY two sections, in this order:

## Rationale
[2–3 sentences explaining the changes you propose to make and why. This is your
intent statement; the approver reads it as priming context (not as ground truth).]

## Rewrite
[The full article body, rewritten to incorporate your edits. Plain markdown — no
CriticMarkup, no commentary, no preamble. Output the article only.]`;

const SCOPE_RULES = `Scope rules:

- The "## Rewrite" section MUST contain the entire article. Do not truncate; do
  not summarize; do not commentate.
- Preserve the existing heading structure: do NOT add or remove headings, and do
  NOT change heading levels (h1 stays h1, h2 stays h2).
- Preserve quotes, citations (e.g. /standalone-title?t=Term URLs), and code
  fences exactly as they appear in the source.
- Do not output any text after the article body. The final character of your
  response should be the last character of the article (or a single trailing
  newline).`;

const AMBITIOUS_DIRECTIVE = `Propose whatever edits you judge will most improve the article — large
structural rewrites, sentence-order swaps, many minor polish edits, or any
mix. Be ambitious. There is no edit budget and no preference for small vs.
large edits. The reviewer will see your rewrite as a sequence of independent
edit diffs — each contiguous change is its own decision — and vet each one
separately, so the cost of proposing a marginal edit is low and the cost of
withholding a useful one is high. Aim to rewrite generously rather than
sparingly.`;

export function buildProposerSystemPromptRewrite(): string {
  return [
    'You propose targeted edits to an article by rewriting it.',
    '',
    FORMAT_SPEC,
    '',
    SCOPE_RULES,
    '',
    AMBITIOUS_DIRECTIVE,
    '',
    'Preservation rules — keep the article structurally intact:',
    ...PRESERVATION_RULES.map((r, i) => `  ${i + 1}. ${r}`),
    '',
    'Self-check before responding:',
    '  1. Confirm your response begins with the literal heading "## Rationale" on its own line.',
    '  2. Confirm "## Rewrite" appears below it on its own line.',
    '  3. Confirm the Rewrite section is the full article body (or close to it — small additions/removals are fine).',
    '  4. Confirm there is NO additional commentary after the article body.',
  ].join('\n');
}

export function buildProposerUserPromptRewrite(currentText: string): string {
  return `<source>\n${currentText}\n</source>\n\nRespond with the two-section format above (## Rationale, then ## Rewrite).`;
}
