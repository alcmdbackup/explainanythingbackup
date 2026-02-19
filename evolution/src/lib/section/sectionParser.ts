// Regex-based section parser that splits markdown articles at H2 (##) boundaries.
// Strips fenced code blocks before splitting to prevent false positives on ## inside code.

import type { ArticleSection, ParsedArticle } from './types';

/** Sentinel used to replace fenced code blocks during parsing. */
const CODE_BLOCK_SENTINEL = '\u0000CODE_BLOCK\u0000';

/**
 * Parse a markdown article into sections at H2 (`## `) boundaries.
 *
 * The preamble (everything before the first `## `) is returned as section 0 with
 * `isPreamble: true`. Fenced code blocks containing `## ` are handled correctly
 * by stripping them before splitting and restoring after.
 */
export function parseArticleIntoSections(markdown: string): ParsedArticle {
  // 1. Strip fenced code blocks (same regex as formatValidator.ts lines 47-48)
  const codeBlocks: string[] = [];
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, (match) => {
      codeBlocks.push(match);
      return CODE_BLOCK_SENTINEL;
    })
    .replace(/```[\s\S]*$/g, (match) => {
      // Unclosed code block at end of file
      codeBlocks.push(match);
      return CODE_BLOCK_SENTINEL;
    });

  // 2. Split at H2 boundaries: lines starting with "## "
  //    We split the stripped text, keeping the delimiter (## heading) at the start of each chunk.
  const h2Pattern = /^(?=## )/m;
  const rawSegments = stripped.split(h2Pattern);

  // 3. Build sections, restoring code blocks
  let codeBlockIdx = 0;
  function restoreCodeBlocks(text: string): string {
    return text.replace(new RegExp(CODE_BLOCK_SENTINEL.replace(/\0/g, '\\0'), 'g'), () => {
      return codeBlocks[codeBlockIdx++] ?? '';
    });
  }

  const sections: ArticleSection[] = [];

  for (let i = 0; i < rawSegments.length; i++) {
    const restored = restoreCodeBlocks(rawSegments[i]);

    if (restored.startsWith('## ')) {
      // H2 section: extract heading from first line
      const newlineIdx = restored.indexOf('\n');
      const headingLine = newlineIdx >= 0 ? restored.slice(0, newlineIdx) : restored;
      const body = newlineIdx >= 0 ? restored.slice(newlineIdx + 1) : '';
      const headingText = headingLine.replace(/^## /, '').trim();

      sections.push({
        index: sections.length,
        heading: headingText,
        body,
        markdown: restored,
        isPreamble: false,
      });
    } else if (restored.length > 0) {
      // Preamble: everything before the first ## (may be empty)
      sections.push({
        index: 0,
        heading: null,
        body: restored,
        markdown: restored,
        isPreamble: true,
      });
    }
  }

  // Handle edge case: no content at all
  if (sections.length === 0) {
    sections.push({
      index: 0,
      heading: null,
      body: markdown,
      markdown,
      isPreamble: true,
    });
  }

  return {
    originalText: markdown,
    sections,
    sectionCount: sections.filter((s) => !s.isPreamble).length,
  };
}
