// Relaxed format validator for individual article sections.
// Applies subset of formatValidator.ts rules: no H1 required, H2 heading required for non-preamble,
// paragraph sentence count enforced, no bullets/lists/tables.

import {
  stripCodeBlocks,
  stripHorizontalRules,
  hasBulletPoints,
  hasNumberedLists,
  hasTables,
  checkParagraphSentenceCount,
} from '../core/formatValidationRules';

export interface SectionFormatResult {
  valid: boolean;
  issues: string[];
}

/**
 * Validate a single section's format with relaxed rules (vs full-article validateFormat).
 *
 * Rules:
 * - No H1 allowed (H1 only appears in preamble/full article)
 * - Non-preamble sections must start with an H2 heading
 * - No bullets, numbered lists, or tables
 * - Paragraphs must have 2+ sentences (25% tolerance)
 */
export function validateSectionFormat(
  sectionText: string,
  isPreamble: boolean,
): SectionFormatResult {
  const issues: string[] = [];
  if (!sectionText.trim()) return { valid: false, issues: ['Empty section'] };

  const lines = sectionText.trim().split('\n');

  // Rule: No H1 in sections (H1 belongs in preamble only)
  const h1Lines = lines.filter((l) => l.startsWith('# ') && !l.startsWith('## '));
  if (h1Lines.length > 0 && !isPreamble) {
    issues.push('Section contains H1 heading (only allowed in preamble)');
  }

  // Rule: Non-preamble sections must start with H2
  if (!isPreamble) {
    const firstNonEmpty = lines.find((l) => l.trim().length > 0);
    if (!firstNonEmpty || !firstNonEmpty.startsWith('## ')) {
      issues.push('Non-preamble section must start with H2 heading');
    }
  }

  // Strip fenced code blocks before checking formatting (PARSE-6).
  const textNoCode = stripCodeBlocks(sectionText);

  // Strip horizontal rules before bullet check
  const textNoHr = stripHorizontalRules(textNoCode);

  // Rule: No bullet points or numbered lists
  if (hasBulletPoints(textNoHr)) {
    issues.push('Contains bullet points');
  }
  if (hasNumberedLists(textNoHr)) {
    issues.push('Contains numbered lists');
  }

  // Rule: No tables
  if (hasTables(textNoCode)) {
    issues.push('Contains tables');
  }

  // Rule: Paragraphs must have 2+ sentences (25% tolerance)
  const sentenceIssue = checkParagraphSentenceCount(textNoCode);
  if (sentenceIssue) {
    issues.push(sentenceIssue);
  }

  return { valid: issues.length === 0, issues };
}
