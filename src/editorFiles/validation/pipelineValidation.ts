/**
 * Pipeline Validation Module
 *
 * Provides validation functions for the 4-step AI suggestions pipeline:
 * 1. Generate AI Suggestions (LLM -> JSON with edits array)
 * 2. Apply AI Suggestions (LLM merges edits into original)
 * 3. Generate AST Diff (markdown -> CriticMarkup)
 * 4. Preprocess CriticMarkup (normalize for Lexical editor)
 */

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  severity: 'warning' | 'error';
}

/**
 * B2: Validates Step 2 output for content preservation
 *
 * Checks:
 * - Length ratio (allow 50% variance: 0.5 < ratio < 2.0)
 * - Heading preservation (>50% preserved)
 * - Unexpanded markers detection ('... existing text ...')
 */
export function validateStep2Output(original: string, edited: string): ValidationResult {
  const issues: string[] = [];

  // Handle edge cases
  if (!original || !edited) {
    return {
      valid: false,
      issues: ['Original or edited content is empty'],
      severity: 'error',
    };
  }

  // Length check (allow 50% variance)
  const ratio = edited.length / original.length;
  if (ratio < 0.5) {
    issues.push(`Content too short: ${Math.round(ratio * 100)}% of original (min 50%)`);
  } else if (ratio > 2.0) {
    issues.push(`Content too long: ${Math.round(ratio * 100)}% of original (max 200%)`);
  }

  // Heading preservation check
  const origHeadings = (original.match(/^#{1,6} .+$/gm) || []).length;
  const editedHeadings = (edited.match(/^#{1,6} .+$/gm) || []).length;
  if (origHeadings > 0 && editedHeadings < origHeadings * 0.5) {
    issues.push(`Lost headings: ${origHeadings} -> ${editedHeadings}`);
  }

  // Unexpanded markers check
  if (edited.includes('... existing text ...')) {
    issues.push('Contains unexpanded markers');
  }

  return {
    valid: issues.length === 0,
    issues,
    severity: issues.some((i) => i.includes('unexpanded') || i.includes('too short')) ? 'error' : 'warning',
  };
}

/**
 * B3: Validates CriticMarkup syntax for balanced markers
 *
 * Checks for balanced:
 * - Insertions: {++ ... ++}
 * - Deletions: {-- ... --}
 * - Substitutions: {~~ ... ~~}
 */
export function validateCriticMarkup(content: string): ValidationResult {
  const issues: string[] = [];

  if (!content) {
    return { valid: true, issues: [], severity: 'warning' };
  }

  // Count insertion markers
  const insertOpen = (content.match(/\{\+\+/g) || []).length;
  const insertClose = (content.match(/\+\+\}/g) || []).length;
  if (insertOpen !== insertClose) {
    issues.push(`Unbalanced insertions: ${insertOpen} opens, ${insertClose} closes`);
  }

  // Count deletion markers
  const deleteOpen = (content.match(/\{--/g) || []).length;
  const deleteClose = (content.match(/--\}/g) || []).length;
  if (deleteOpen !== deleteClose) {
    issues.push(`Unbalanced deletions: ${deleteOpen} opens, ${deleteClose} closes`);
  }

  // Count substitution markers
  const subOpen = (content.match(/\{~~/g) || []).length;
  const subClose = (content.match(/~~\}/g) || []).length;
  if (subOpen !== subClose) {
    issues.push(`Unbalanced substitutions: ${subOpen} opens, ${subClose} closes`);
  }

  // Check for substitutions without separator
  if (subOpen > 0) {
    const subSeparators = (content.match(/~>/g) || []).length;
    if (subSeparators < subOpen) {
      issues.push(`Missing ~> separators in substitutions: expected ${subOpen}, found ${subSeparators}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    severity: 'error',
  };
}

/**
 * P: Validates that edit anchors exist in original content
 *
 * Each edit should include anchor sentences from the original content
 * that help locate where to apply the edit.
 */
export function validateEditAnchors(edits: string[], original: string): ValidationResult {
  const issues: string[] = [];

  if (!edits || edits.length === 0) {
    return { valid: true, issues: [], severity: 'warning' };
  }

  // Extract sentences from original for anchor validation
  const originalSentences = extractSentences(original);
  if (originalSentences.length === 0) {
    return { valid: true, issues: [], severity: 'warning' };
  }

  // Check each edit (skip markers)
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i];
    if (edit === '... existing text ...') continue;

    // Extract first and last sentences from edit
    const editSentences = extractSentences(edit);
    if (editSentences.length === 0) continue;

    const firstSentence = editSentences[0];
    const lastSentence = editSentences[editSentences.length - 1];

    // Check if at least one anchor exists in original
    const hasAnchor =
      originalSentences.some((s) => sentenceSimilarity(s, firstSentence) > 0.8) ||
      originalSentences.some((s) => sentenceSimilarity(s, lastSentence) > 0.8);

    if (!hasAnchor && editSentences.length > 1) {
      issues.push(`Edit ${i + 1} may lack context anchors from original`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    severity: 'warning',
  };
}

/**
 * Extracts sentences from text
 */
function extractSentences(text: string): string[] {
  if (!text) return [];
  // Split on sentence boundaries, filter empty
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
}

/**
 * Simple sentence similarity using word overlap
 */
function sentenceSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));

  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;

  return union > 0 ? intersection / union : 0;
}

/**
 * H: Stack-based parser for balanced CriticMarkup extraction
 *
 * Handles nested braces like {++code with {curly}++}
 */
export function extractBalancedCriticMarkup(
  input: string,
  startIndex: number
): { content: string; marker: string; endIndex: number } | null {
  // Check for CriticMarkup start pattern
  const markerMatch = input.slice(startIndex).match(/^\{([+-~]{2})/);
  if (!markerMatch) return null;

  const marker = markerMatch[1];
  const closeMarker = marker + '}';
  let depth = 1;
  let i = startIndex + 3; // Skip opening {++ or {-- or {~~

  while (i < input.length && depth > 0) {
    // Check for nested opening
    if (input.slice(i, i + 3) === '{' + marker) {
      depth++;
      i += 3;
      continue;
    }

    // Check for closing
    if (input.slice(i, i + 3) === closeMarker) {
      depth--;
      if (depth === 0) {
        break;
      }
      i += 3;
      continue;
    }

    i++;
  }

  if (depth !== 0) return null;

  return {
    content: input.slice(startIndex + 3, i),
    marker,
    endIndex: i + 3,
  };
}

/**
 * I: Parses update content using indexOf for first separator only
 *
 * Handles content that contains ~> by only using first occurrence
 */
export function parseUpdateContent(inner: string): { before: string; after: string } | null {
  const idx = inner.indexOf('~>');
  if (idx === -1) return null;
  return {
    before: inner.slice(0, idx),
    after: inner.slice(idx + 2),
  };
}

/**
 * M: Checks if an index is inside a code block
 *
 * Used to skip preprocessing inside code fences
 */
export function isInsideCodeBlock(content: string, index: number): boolean {
  const before = content.slice(0, index);
  const fenceCount = (before.match(/```/g) || []).length;
  return fenceCount % 2 === 1;
}

/**
 * C: Escapes CriticMarkup special characters in content
 *
 * Prevents content with {++ or ~> from breaking CriticMarkup syntax
 */
export function escapeCriticMarkupContent(text: string): string {
  return text
    .replace(/\{(\+\+|--|~~)/g, '\\{$1')
    .replace(/(\+\+|--|~~)\}/g, '$1\\}')
    .replace(/~>/g, '\\~>');
}

/**
 * C: Unescapes CriticMarkup special characters for export
 */
export function unescapeCriticMarkupContent(text: string): string {
  return text
    .replace(/\\\{(\+\+|--|~~)/g, '{$1')
    .replace(/(\+\+|--|~~)\\\}/g, '$1}')
    .replace(/\\~>/g, '~>');
}

/**
 * N: Validates that content segments are not empty
 */
export function validateNonEmptyContent(content: string): ValidationResult {
  const issues: string[] = [];

  if (!content || content.trim().length === 0) {
    issues.push('Content is empty or whitespace only');
  }

  return {
    valid: issues.length === 0,
    issues,
    severity: 'error',
  };
}
