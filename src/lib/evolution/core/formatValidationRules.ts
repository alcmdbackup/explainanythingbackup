// Shared format validation rules used by both the full-article formatValidator
// and the section-level sectionFormatValidator to eliminate duplicated logic.

/** Regex matching bullet list lines (-, *, +) with optional leading whitespace. */
const BULLET_PATTERN = /^\s*[-*+]\s/m;

/** Regex matching numbered list lines (1. or 1)) with optional leading whitespace. */
const NUMBERED_LIST_PATTERN = /^\s*\d+[.)]\s/m;

/** Regex matching markdown table lines starting and ending with |. */
const TABLE_PATTERN = /^\|.+\|/m;

/** Regex matching horizontal rules (---, ***, ___) with optional spacing. */
const HORIZONTAL_RULE_PATTERN = /^\s*[-*_](\s*[-*_]){2,}\s*$/m;

/** Regex matching sentence-ending punctuation, including smart quotes. */
const SENTENCE_END_PATTERN = /[.!?][""\u201d\u2019]?(?:\s|$)/g;

/**
 * Strip fenced code blocks from text so formatting rules are not applied to code.
 * Uses PARSE-6 logic: first strip matched pairs, then only strip a truly unclosed
 * trailing fence if one remains.
 */
export function stripCodeBlocks(text: string): string {
  let result = text.replace(/```[\s\S]*?```/g, '');
  const remainingFences = (result.match(/```/g) ?? []).length;
  if (remainingFences > 0) {
    result = result.replace(/```[\s\S]*$/, '');
  }
  return result;
}

/**
 * Strip horizontal rules from text so they are not falsely detected as bullet points.
 */
export function stripHorizontalRules(text: string): string {
  return text.replace(HORIZONTAL_RULE_PATTERN, '');
}

/** Returns true if the text contains bullet point lines (-, *, +). */
export function hasBulletPoints(text: string): boolean {
  return BULLET_PATTERN.test(text);
}

/** Returns true if the text contains numbered list lines (1., 2), etc.). */
export function hasNumberedLists(text: string): boolean {
  return NUMBERED_LIST_PATTERN.test(text);
}

/** Returns true if the text contains markdown table lines. */
export function hasTables(text: string): boolean {
  return TABLE_PATTERN.test(text);
}

/**
 * Extract paragraph blocks from text, filtering out headings, horizontal rules,
 * emphasis-only lines, and label lines ending with a colon.
 */
export function extractParagraphs(text: string): string[] {
  const blocks = text
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
  return paragraphs;
}

/**
 * Count the number of paragraphs that have fewer than 2 sentences.
 */
export function countShortParagraphs(paragraphs: string[]): number {
  let shortCount = 0;
  for (const para of paragraphs) {
    const sentences = (para.match(SENTENCE_END_PATTERN) ?? []).length;
    if (sentences < 2) shortCount++;
  }
  return shortCount;
}

/**
 * Check paragraph sentence count against a tolerance threshold.
 * Returns an issue message if too many short paragraphs, or null if valid.
 */
export function checkParagraphSentenceCount(
  textNoCode: string,
  tolerance = 0.25,
): string | null {
  const paragraphs = extractParagraphs(textNoCode);
  if (paragraphs.length === 0) return null;

  const shortCount = countShortParagraphs(paragraphs);
  if (shortCount / paragraphs.length > tolerance) {
    return `${shortCount}/${paragraphs.length} paragraphs with <2 sentences`;
  }
  return null;
}
