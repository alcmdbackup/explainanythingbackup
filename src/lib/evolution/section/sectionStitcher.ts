// Section stitcher that reassembles parsed sections into a complete markdown article.
// Supports selective replacement of individual sections while preserving others.

import type { ArticleSection, ParsedArticle } from './types';

/**
 * Stitch an array of sections back into a single markdown string.
 * Concatenates `section.markdown` values directly (no extra separators added).
 */
export function stitchSections(sections: ArticleSection[]): string {
  return sections.map((s) => s.markdown).join('');
}

export interface StitchResult {
  text: string;
  /** SEC-1: Replacement indices that didn't match any section (out-of-bounds). */
  unusedIndices: number[];
}

/**
 * Stitch a ParsedArticle back together, replacing specific sections.
 *
 * @param parsed - The original parsed article
 * @param replacements - Map of section index → replacement markdown string
 * @returns The reassembled article with replacements applied and any unused indices
 */
export function stitchWithReplacements(
  parsed: ParsedArticle,
  replacements: Map<number, string>,
): StitchResult {
  const usedIndices = new Set<number>();
  const text = parsed.sections.map((section) => {
    const replacement = replacements.get(section.index);
    if (replacement !== undefined) usedIndices.add(section.index);
    return replacement !== undefined ? replacement : section.markdown;
  }).join('');

  // SEC-1: Report any replacement indices that didn't match a section
  const unusedIndices = [...replacements.keys()].filter((idx) => !usedIndices.has(idx));

  return { text, unusedIndices };
}
