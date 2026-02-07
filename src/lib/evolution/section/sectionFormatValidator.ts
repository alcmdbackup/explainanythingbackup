// Relaxed format validator for individual article sections.
// Applies subset of formatValidator.ts rules: no H1 required, H2 heading required for non-preamble,
// paragraph sentence count enforced, no bullets/lists/tables.

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

  // Strip fenced code blocks before checking formatting (same as formatValidator.ts)
  let textNoCode = sectionText.replace(/```[\s\S]*?```/g, '');
  textNoCode = textNoCode.replace(/```[\s\S]*$/g, '');

  // Strip horizontal rules before bullet check
  const textNoHr = textNoCode.replace(/^\s*[-*_](\s*[-*_]){2,}\s*$/gm, '');

  // Rule: No bullet points or numbered lists
  if (/^\s*[-*+]\s/m.test(textNoHr)) {
    issues.push('Contains bullet points');
  }
  if (/^\s*\d+[.)]\s/m.test(textNoHr)) {
    issues.push('Contains numbered lists');
  }

  // Rule: No tables
  if (/^\|.+\|/m.test(textNoCode)) {
    issues.push('Contains tables');
  }

  // Rule: Paragraphs must have 2+ sentences (25% tolerance)
  const blocks = textNoCode
    .split('\n\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.startsWith('#')) continue;
    if (/^[-*_](\s*[-*_]){2,}\s*$/.test(block)) continue;
    if (/^\*[^*\n]+\*$/.test(block)) continue;
    if (block.trim().endsWith(':')) continue;
    paragraphs.push(block);
  }

  let shortCount = 0;
  for (const para of paragraphs) {
    const sentences = (para.match(/[.!?][""\u201d\u2019]?(?:\s|$)/g) ?? []).length;
    if (sentences < 2) shortCount++;
  }

  if (paragraphs.length > 0 && shortCount / paragraphs.length > 0.25) {
    issues.push(`${shortCount}/${paragraphs.length} paragraphs with <2 sentences`);
  }

  return { valid: issues.length === 0, issues };
}
