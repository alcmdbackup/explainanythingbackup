// Shared helper for formatting all MetaFeedback fields into LLM prompt sections.
// Replaces inline extraction that only used priorityImprovements.

import type { MetaFeedback } from '../../types';

/**
 * Format all 4 MetaFeedback fields into a structured prompt section.
 * Returns null when feedback is null or completely empty.
 */
export function formatMetaFeedback(feedback: MetaFeedback | null): string | null {
  if (!feedback) return null;

  const sections: string[] = [];

  if (feedback.priorityImprovements.length > 0) {
    sections.push(`### Priority Improvements\n${feedback.priorityImprovements.map(s => `- ${s}`).join('\n')}`);
  }

  if (feedback.recurringWeaknesses.length > 0) {
    sections.push(`### Recurring Weaknesses to Fix\n${feedback.recurringWeaknesses.map(s => `- ${s}`).join('\n')}`);
  }

  if (feedback.successfulStrategies.length > 0) {
    sections.push(`### Successful Strategies (keep doing these)\n${feedback.successfulStrategies.map(s => `- ${s}`).join('\n')}`);
  }

  if (feedback.patternsToAvoid.length > 0) {
    sections.push(`### Patterns to Avoid\n${feedback.patternsToAvoid.map(s => `- ${s}`).join('\n')}`);
  }

  if (sections.length === 0) return null;

  return sections.join('\n\n');
}
