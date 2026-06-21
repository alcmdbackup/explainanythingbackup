// Shared prompt template for the evolution pipeline's generate and evolve phases.

import { FORMAT_RULES } from '../../shared/enforceVariantFormat';

type Feedback = { weakestDimension: string; suggestions: string[] };

function feedbackSection(feedback?: Feedback): string {
  if (!feedback) return '';
  return `\n## Feedback\nWeakest dimension: ${feedback.weakestDimension}\nSuggestions:\n${feedback.suggestions.map((s) => `- ${s}`).join('\n')}\n`;
}

/**
 * Build a standard evolution prompt with consistent structure:
 * preamble → source text → optional feedback → task instructions → optional target style → format rules.
 *
 * The trailing optionals are an options bag (generate_enforce_style_fingerprint_evolution_20260620):
 * `styleGuide` injects a `## Target Style` block between the task instructions and FORMAT_RULES.
 * Output is byte-identical to the pre-style version when `styleGuide` is omitted.
 */
export function buildEvolutionPrompt(
  preamble: string,
  textLabel: string,
  text: string,
  instructions: string,
  opts?: { feedback?: Feedback; styleGuide?: string },
): string {
  const styleSection = opts?.styleGuide ? `## Target Style\n${opts.styleGuide}\n` : '';
  return `${preamble}

## ${textLabel}
${text}
${feedbackSection(opts?.feedback)}## Task
${instructions}
${styleSection}${FORMAT_RULES}
Output ONLY the improved text, no explanations.`;
}
