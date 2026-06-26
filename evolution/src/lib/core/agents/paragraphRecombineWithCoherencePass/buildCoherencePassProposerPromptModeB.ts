// rebuild_coherence_pass_agent_mode_ab_configurable_20260624.
//
// Mode B (rewrite-then-diff) proposer prompt for the coherence pass. The
// proposer emits a short rationale block + a fully rewritten article body;
// runEditingCycle then computes CriticMarkup via diff. Mode A counterpart
// lives in buildCoherencePassProposerPrompt.ts.

const PRESERVATION_RULES = [
  'Preserve quotes, citations, and URLs exactly as they appear in the original.',
  'Do not introduce new headings or modify existing heading lines.',
  'Do not edit text inside code fences (```).',
];

const FORMAT_SPEC = `Output format — respond with EXACTLY two sections, in this order:

## Rationale
[2–3 sentences explaining the voice / cadence / structural-repair edits you
propose and why. This is your intent statement; the approver reads it as
priming context (not as ground truth).]

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

const AMBITIOUS_DIRECTIVE = `The article you're reviewing was assembled from paragraphs rewritten
independently in parallel. Voice and cadence may have flattened across them;
substantive structural and voice-restoration rewrites are exactly what's
wanted.

Propose whatever edits you judge will most restore the article's voice,
cadence, and structural rhythm — large structural rewrites, sentence-order
swaps, whole-paragraph rewrites, or any mix. Be ambitious. There is no edit
budget and no preference for small vs. large edits. The reviewer will see
your rewrite as a sequence of independent edit diffs — each contiguous change
is its own decision — and vet each one separately, so the cost of proposing
a marginal edit is low and the cost of withholding a useful one is high. Aim
to rewrite generously rather than sparingly.`;

const COHERENCE_FOCUS = `Look for in particular:
  (a) paragraphs that start abruptly with no transition from the previous one;
  (b) rhetorical hooks ("Imagine a time when…") that appear in some paragraphs
      but get dropped in others;
  (c) inconsistent voice register (formal vs. casual) across adjacent
      paragraphs;
  (d) repeated explanations of the same concept that two independent rewriters
      both included.`;

const LENGTH_HINT = `LENGTH — you may grow the article up to ~10% in total length. Edits beyond
that ceiling get trimmed downstream by the size-ratio validator, so aim to
stay inside it. Within that ceiling, do as much repair as the article needs.`;

export function buildCoherencePassProposerSystemPromptModeB(): string {
  return [
    'You repair the voice, cadence, and structural rhythm of an article whose paragraphs were rewritten independently and recombined. Your output is a ## Rationale block followed by a ## Rewrite block containing the full rewritten article body.',
    '',
    FORMAT_SPEC,
    '',
    SCOPE_RULES,
    '',
    COHERENCE_FOCUS,
    '',
    AMBITIOUS_DIRECTIVE,
    '',
    LENGTH_HINT,
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

export function buildCoherencePassProposerUserPromptModeB(recombinedArticle: string): string {
  return `<source>\n${recombinedArticle}\n</source>\n\nRespond with the two-section format above (## Rationale, then ## Rewrite). Apply voice-restoration and structural-repair edits in the rewrite.`;
}
