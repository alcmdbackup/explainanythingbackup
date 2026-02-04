// Diff-based comparison using CriticMarkup and direction reversal for bias mitigation.
// Separate from comparison.ts to avoid ESM contamination (unified/remark-parse are ESM-only).

import { RenderCriticMarkupFromMDAstDiff } from '../../editorFiles/markdownASTdiff/markdownASTdiff';

/**
 * Parse markdown string to MDAST root node.
 * Uses dynamic import() for unified/remark-parse (ESM-only packages),
 * matching the pattern in aiSuggestion.ts:safeParseMarkdown().
 * Returns null on parse failure (malformed markdown from LLM output).
 */
async function parseToMdast(markdown: string): Promise<unknown | null> {
  try {
    const { unified } = await import('unified');
    const { default: remarkParse } = await import('remark-parse');
    return unified().use(remarkParse).parse(markdown);
  } catch {
    return null;
  }
}

/** Result of a diff-based comparison using direction reversal. */
export interface DiffComparisonResult {
  verdict: 'ACCEPT' | 'REJECT' | 'UNSURE';
  confidence: number;
  changesFound: number;
}

/**
 * Evaluates whether targeted edits improve an article by generating a CriticMarkup diff
 * and running 2-pass direction reversal (forward diff + reverse diff) for bias mitigation.
 */
export async function compareWithDiff(
  textBefore: string,
  textAfter: string,
  callLLM: (prompt: string) => Promise<string>,
): Promise<DiffComparisonResult> {
  const beforeAst = await parseToMdast(textBefore);
  const afterAst = await parseToMdast(textAfter);

  if (!beforeAst || !afterAst) {
    return { verdict: 'UNSURE', confidence: 0, changesFound: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forwardDiff = RenderCriticMarkupFromMDAstDiff(beforeAst as any, afterAst as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reverseDiff = RenderCriticMarkupFromMDAstDiff(afterAst as any, beforeAst as any);

  const changesFound = (forwardDiff.match(/\{[+\-~]/g) || []).length;

  if (changesFound === 0) {
    return { verdict: 'UNSURE', confidence: 0, changesFound: 0 };
  }

  // Pass 1: Forward (original → edited)
  const forwardPrompt = buildDiffJudgePrompt(forwardDiff);
  const forwardResult = parseDiffVerdict(await callLLM(forwardPrompt));

  // Pass 2: Reverse (edited → original)
  const reversePrompt = buildDiffJudgePrompt(reverseDiff);
  const reverseResult = parseDiffVerdict(await callLLM(reversePrompt));

  return interpretDirectionReversal(forwardResult, reverseResult, changesFound);
}

/** Build the blind judge prompt from a CriticMarkup diff string. Exported for unit testing. */
export function buildDiffJudgePrompt(criticMarkupDiff: string): string {
  return `You are an expert writing evaluator. The following article contains proposed changes
marked with CriticMarkup notation:

- {--deleted text--} = text that would be removed
- {++inserted text++} = text that would be added
- {~~old text~>new text~~} = text that would be replaced

## Article with Proposed Changes
${criticMarkupDiff}

## Evaluation Criteria
Consider whether the proposed changes, taken as a whole:
- Improve or harm clarity and readability
- Improve or harm structure and flow
- Improve or harm engagement and impact
- Improve or harm grammar and style
- Improve or harm overall effectiveness

## Instructions
Respond with ONLY one of these exact answers:
- "ACCEPT" if the changes improve the article overall
- "REJECT" if the changes harm the article overall
- "UNSURE" if the changes are neutral or have mixed effects`;
}

/** Extract ACCEPT/REJECT/UNSURE from LLM response text. Exported for unit testing. */
export function parseDiffVerdict(response: string): 'ACCEPT' | 'REJECT' | 'UNSURE' {
  const upper = response.trim().toUpperCase();
  if (upper.includes('ACCEPT')) return 'ACCEPT';
  if (upper.includes('REJECT')) return 'REJECT';
  return 'UNSURE';
}

/** Combine forward+reverse verdicts into a single bias-mitigated result. Exported for unit testing. */
export function interpretDirectionReversal(
  forward: 'ACCEPT' | 'REJECT' | 'UNSURE',
  reverse: 'ACCEPT' | 'REJECT' | 'UNSURE',
  changesFound: number,
): DiffComparisonResult {
  // Consistent: forward=ACCEPT, reverse=REJECT → edit improves article
  if (forward === 'ACCEPT' && reverse === 'REJECT') {
    return { verdict: 'ACCEPT', confidence: 1.0, changesFound };
  }
  // Consistent: forward=REJECT, reverse=ACCEPT → edit harms article
  if (forward === 'REJECT' && reverse === 'ACCEPT') {
    return { verdict: 'REJECT', confidence: 1.0, changesFound };
  }
  // Inconsistent: both ACCEPT or both REJECT → framing bias
  if (forward === reverse && forward !== 'UNSURE') {
    return { verdict: 'UNSURE', confidence: 0.5, changesFound };
  }
  // One or both UNSURE
  return { verdict: 'UNSURE', confidence: 0.3, changesFound };
}
