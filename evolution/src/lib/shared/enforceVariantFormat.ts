// Format rules, validation rule functions, and article-level format validator — consolidated
// from formatRules.ts, formatValidationRules.ts, and formatValidator.ts.

// ═══════════════════════════════════════════════════════════════════
// Format Rules (prompt injection)
// ═══════════════════════════════════════════════════════════════════

export const FORMAT_RULES = `
=== OUTPUT FORMAT RULES (MANDATORY — violations cause rejection) ===
Start with a single H1 title using the Markdown "# Title" syntax. Use Markdown headings at the ## or ### level to introduce each new section or topic shift. Write in complete paragraphs of two or more sentences each, separated by blank lines. Never use bullet points, numbered lists, or tables anywhere in the output. Every block of body text must be a full paragraph.
===================================================================
`;

// ═══════════════════════════════════════════════════════════════════
// Validation Rule Functions
// ═══════════════════════════════════════════════════════════════════

const BULLET_PATTERN = /^\s*[-*+]\s/m;
const NUMBERED_LIST_PATTERN = /^\s*\d+[.)]\s/m;
const TABLE_PATTERN = /^\|.+\|/m;
const HORIZONTAL_RULE_PATTERN = /^\s*[-*_](\s*[-*_]){2,}\s*$/m;
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

/** Strip horizontal rules from text so they are not falsely detected as bullet points. */
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

/** Count the number of paragraphs that have fewer than 2 sentences. */
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

// ═══════════════════════════════════════════════════════════════════
// Format Validator
// ═══════════════════════════════════════════════════════════════════

export interface FormatResult {
  valid: boolean;
  issues: string[];
}

function getValidationMode(): string {
  return process.env.FORMAT_VALIDATION_MODE ?? 'reject';
}

function findH1Lines(lines: string[]): number[] {
  const h1Lines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('# ') && !lines[i].startsWith('## ')) {
      h1Lines.push(i);
    }
  }
  return h1Lines;
}

/** Validate article text format. Returns issues; empty issues + valid=true means compliant. */
export function validateFormat(text: string): FormatResult {
  const mode = getValidationMode();
  if (mode === 'off') return { valid: true, issues: [] };

  const issues: string[] = [];
  if (!text.trim()) return { valid: false, issues: ['Empty text'] };

  const lines = text.trim().split('\n');

  // Rule 1: Exactly one H1 title on the first non-empty line
  const h1Lines = findH1Lines(lines);

  if (h1Lines.length === 0) {
    issues.push('Missing H1 title');
  } else if (h1Lines.length > 1) {
    issues.push(`Multiple H1 titles (lines ${h1Lines.join(', ')})`);
  } else if (h1Lines[0] !== 0) {
    const firstNonempty = lines.findIndex((l) => l.trim().length > 0);
    if (h1Lines[0] !== firstNonempty) {
      issues.push('H1 title is not on the first line');
    }
  }

  // Rule 2: Must have section headings (## or ###)
  const hasSectionHeadings = lines.some((l) => l.startsWith('## ') || l.startsWith('### '));
  if (!hasSectionHeadings) {
    issues.push('No section headings (## or ###)');
  }

  // Strip fenced code blocks before checking bullets/lists/tables (PARSE-6).
  const textNoCode = stripCodeBlocks(text);
  const textNoHr = stripHorizontalRules(textNoCode);

  // Rule 3a: No bullet points or numbered lists
  if (hasBulletPoints(textNoHr)) {
    issues.push('Contains bullet points');
  }
  if (hasNumberedLists(textNoHr)) {
    issues.push('Contains numbered lists');
  }

  // Rule 3b: No tables
  if (hasTables(textNoCode)) {
    issues.push('Contains tables');
  }

  // Rule 4: Paragraphs must have 2+ sentences (with 25% tolerance)
  const sentenceIssue = checkParagraphSentenceCount(textNoCode);
  if (sentenceIssue) {
    issues.push(sentenceIssue);
  }

  if (mode === 'warn') return { valid: true, issues };
  return { valid: issues.length === 0, issues };
}
