// Shared prompt template for the evolution pipeline's generate and evolve phases.

import { FORMAT_RULES } from '../shared/formatRules';

type Feedback = { weakestDimension: string; suggestions: string[] };

function feedbackSection(feedback?: Feedback): string {
  if (!feedback) return '';
  return `\n## Feedback\nWeakest dimension: ${feedback.weakestDimension}\nSuggestions:\n${feedback.suggestions.map((s) => `- ${s}`).join('\n')}\n`;
}

/**
 * Build a standard evolution prompt with consistent structure:
 * preamble → source text → optional feedback → task instructions → format rules.
 */
export function buildEvolutionPrompt(
  preamble: string,
  textLabel: string,
  text: string,
  instructions: string,
  feedback?: Feedback,
): string {
  return `${preamble}

## ${textLabel}
${text}
${feedbackSection(feedback)}## Task
${instructions}
${FORMAT_RULES}
Output ONLY the improved text, no explanations.`;
}
