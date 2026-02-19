// Standalone section-level edit runner: critique→edit→judge loop per section.
// Does NOT re-enter IterativeEditingAgent; follows same prompt/judge pattern but operates on section text.

import type { ArticleSection } from './types';
import type { EvolutionLLMClient, LLMCompletionOptions } from '../types';
import { compareWithDiff } from '../diffComparison';
import { validateSectionFormat } from './sectionFormatValidator';
import { FORMAT_RULES } from '../agents/formatRules';

/** Weakness descriptor for a section edit target. */
export interface SectionWeakness {
  dimension: string;
  description: string;
}

/** Result of a section edit attempt. */
export interface SectionEditResult {
  sectionIndex: number;
  improved: boolean;
  markdown: string;
  costUsd: number;
}

/** Max edit→judge cycles per section (lower than full article's 3 since sections are smaller). */
const MAX_CYCLES = 2;

/**
 * Run critique→edit→judge loop on a single section.
 *
 * @param section - The section to edit
 * @param fullArticleText - Full article text for context (not edited, just shown to LLM)
 * @param weakness - The weakness to target
 * @param llmClient - LLM client for generating edits and judging
 * @param agentName - Agent name for cost tracking
 * @param options - Optional LLM options (e.g., judge model)
 * @returns Section edit result with improved flag and new markdown
 */
export async function runSectionEdit(
  section: ArticleSection,
  fullArticleText: string,
  weakness: SectionWeakness,
  llmClient: EvolutionLLMClient,
  agentName: string,
  options?: { judgeModel?: LLMCompletionOptions['model'] },
): Promise<SectionEditResult> {
  let currentMarkdown = section.markdown;
  let improved = false;

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    // EDIT: generate targeted fix for this section
    const editPrompt = buildSectionEditPrompt(
      currentMarkdown,
      fullArticleText,
      weakness,
      section.isPreamble,
    );
    const editedText = await llmClient.complete(editPrompt, agentName);

    // Validate section format
    const formatResult = validateSectionFormat(editedText, section.isPreamble);
    if (!formatResult.valid) {
      continue; // Skip this cycle, try again
    }

    // JUDGE: blind diff-based comparison (forward + reverse for bias mitigation)
    const judgeOptions: LLMCompletionOptions | undefined = options?.judgeModel
      ? { model: options.judgeModel }
      : undefined;
    const callLLM = (prompt: string) =>
      llmClient.complete(prompt, agentName, judgeOptions);
    const result = await compareWithDiff(currentMarkdown, editedText, callLLM);

    if (result.verdict === 'ACCEPT') {
      currentMarkdown = editedText;
      improved = true;
      break; // Accept and stop — one good edit per section is sufficient
    }
    // REJECT or UNSURE: continue to next cycle
  }

  return {
    sectionIndex: section.index,
    improved,
    markdown: currentMarkdown,
    costUsd: 0, // Cost tracked via costTracker, not per-call
  };
}

/** Build the section-scoped edit prompt. */
function buildSectionEditPrompt(
  sectionMarkdown: string,
  fullArticleText: string,
  weakness: SectionWeakness,
  isPreamble: boolean,
): string {
  const sectionLabel = isPreamble ? 'the introduction/preamble' : 'this section';

  return `You are a surgical writing editor. Fix ONLY the identified weakness in ${sectionLabel} while preserving all other qualities.

## Full Article (for context only — do NOT rewrite the full article)
${fullArticleText}

## Section to Edit
${sectionMarkdown}

## Weakness to Fix: ${weakness.dimension.toUpperCase()}
${weakness.description}

## Instructions
- Rewrite ONLY ${sectionLabel} to address the weakness
- Do NOT include any content from other sections
- Preserve the section heading (## line) exactly as-is
- Preserve structure, tone, and all other qualities
- Keep the same overall length (within 15%)
${isPreamble ? '- This is the preamble section (before first ##). It may include an H1 title.' : '- This section must start with its ## heading line.'}

${FORMAT_RULES}

Output ONLY the complete revised section text, nothing else.`;
}
