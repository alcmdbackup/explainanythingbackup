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

/**
 * Stitch a ParsedArticle back together, replacing specific sections.
 *
 * @param parsed - The original parsed article
 * @param replacements - Map of section index → replacement markdown string
 * @returns The reassembled article with replacements applied
 */
export function stitchWithReplacements(
  parsed: ParsedArticle,
  replacements: Map<number, string>,
): string {
  return parsed.sections.map((section) => {
    const replacement = replacements.get(section.index);
    return replacement !== undefined ? replacement : section.markdown;
  }).join('');
}
