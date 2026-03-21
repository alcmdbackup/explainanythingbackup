// Format validator checking article text against formatting rules.
// Controlled by FORMAT_VALIDATION_MODE env var: "reject" (default), "warn", or "off".

import {
  stripCodeBlocks,
  stripHorizontalRules,
  hasBulletPoints,
  hasNumberedLists,
  hasTables,
  checkParagraphSentenceCount,
} from './formatValidationRules';

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

  // Strip horizontal rules before bullet check
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
