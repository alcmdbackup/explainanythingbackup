// Pure prompt assembly for the prompt-editor. Reuses the pipeline's prompt builders so the
// prompt editor sends the exact prompt shape the real rewrite agents would, with the editable parts
// (article preamble+instructions / paragraph directive) swapped in.

import { buildEvolutionPrompt } from '@evolution/lib/pipeline/loop/buildPrompts';
import { buildParagraphRewritePrompt } from '@evolution/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt';
import type { ArticlePromptSpec, ParagraphPromptSpec, PromptSpec, RewriteUnit } from './types';

function isArticleSpec(spec: PromptSpec): spec is ArticlePromptSpec {
  return (spec as ArticlePromptSpec).instructions !== undefined;
}

/**
 * Build the single rewrite prompt for one prompt editor config.
 *
 * - article: buildEvolutionPrompt(preamble, 'Original Text', sourceText, instructions) — appends
 *   FORMAT_RULES automatically, matching GenerateFromPreviousArticleAgent's generation prompt.
 * - paragraph: buildParagraphRewritePrompt(title, sourceText, 0, 1, directive) — the per-slot
 *   rewrite scaffolding (preserve meaning, ±20% length) around the editable directive.
 */
export function buildPromptEditorPrompt(
  unit: RewriteUnit,
  sourceText: string,
  spec: PromptSpec,
  title = '',
): string {
  if (unit === 'article') {
    if (!isArticleSpec(spec)) {
      throw new Error('article unit requires an ArticlePromptSpec ({ preamble, instructions })');
    }
    return buildEvolutionPrompt(spec.preamble, 'Original Text', sourceText, spec.instructions);
  }
  if (isArticleSpec(spec)) {
    throw new Error('paragraph unit requires a ParagraphPromptSpec ({ directive })');
  }
  const { directive } = spec as ParagraphPromptSpec;
  return buildParagraphRewritePrompt(title, sourceText, 0, 1, directive);
}
