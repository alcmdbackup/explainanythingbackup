// Paragraph-slot helpers for paragraph_recombine.
// Per Phase 3 of rank_individual_paragraphs_evolution_20260525.
//
// extractParagraphsWithRanges: walk the article text post-stripCodeBlocks, split on \n\n,
//   filter out heading-only lines, and track cumulative byte offsets so the reassembly step
//   can splice winning rewrites back into the article at the original paragraph positions.
//
// validateParagraphRewrite: per-paragraph pre-validation (drop bad rewrites before they
//   consume ranking budget). Composed from existing primitives (hasBulletPoints, etc.).
//   Symmetric ±20% length cap per D7/D12 (widened from ±10%).
//
// assembleRecombinedArticle: right-to-left splice (mirrors applyAcceptedGroups pattern)
//   so earlier slots' byte offsets stay valid as later slots are replaced.

import { stripCodeBlocks, hasBulletPoints, hasNumberedLists, hasTables, countShortParagraphs } from './enforceVariantFormat';

export interface ParagraphSlot {
  /** 0-based index of the paragraph in the article (skipping heading-only blocks). */
  paragraphIndex: number;
  /** The original paragraph text (trimmed). */
  originalText: string;
  /** Byte offset (in the ORIGINAL untrimmed article text) where this paragraph starts. */
  startByte: number;
  /** Byte offset (in the ORIGINAL untrimmed article text) where this paragraph ends (exclusive). */
  endByte: number;
}

/**
 * Walk the article text and return paragraph slots with byte ranges. Each slot's
 * `startByte`/`endByte` are offsets into the ORIGINAL `text` argument (not the
 * code-stripped variant), so `text.slice(slot.startByte, slot.endByte)` recovers
 * the original (possibly leading/trailing whitespace) span.
 *
 * Filters out heading-only blocks (lines starting with `#`), horizontal-rule blocks,
 * emphasis-only blocks (`*foo*`), and label lines ending with `:`. Matches the
 * existing `extractParagraphs` behavior plus byte-range tracking.
 *
 * Code blocks: code-fenced regions are NOT included as paragraphs. We use the existing
 * stripCodeBlocks helper to identify them; the byte ranges returned exclude code-fenced
 * spans.
 */
export function extractParagraphsWithRanges(text: string): ParagraphSlot[] {
  // First, identify code-fenced spans in the ORIGINAL text so we can skip paragraphs
  // that fall inside them. We don't actually strip the code from `text` — we just
  // mark those byte ranges as off-limits for paragraph extraction.
  const codeBlockRanges: Array<[number, number]> = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let codeMatch;
  while ((codeMatch = codeBlockRegex.exec(text)) !== null) {
    codeBlockRanges.push([codeMatch.index, codeMatch.index + codeMatch[0].length]);
  }
  const isInCodeBlock = (offset: number): boolean =>
    codeBlockRanges.some(([s, e]) => offset >= s && offset < e);

  const slots: ParagraphSlot[] = [];
  let paragraphIndex = 0;
  let cursor = 0;
  const blockSeparator = '\n\n';
  while (cursor < text.length) {
    // Find the next \n\n boundary (or end of text).
    const nextBoundary = text.indexOf(blockSeparator, cursor);
    const blockEnd = nextBoundary === -1 ? text.length : nextBoundary;
    const blockStart = cursor;
    const blockText = text.slice(blockStart, blockEnd);
    const trimmed = blockText.trim();

    // Advance cursor past the block + the \n\n separator (or to end of text).
    cursor = nextBoundary === -1 ? text.length : nextBoundary + blockSeparator.length;

    // Filter rules — matches extractParagraphs behavior.
    if (trimmed.length === 0) continue;
    if (isInCodeBlock(blockStart)) continue;
    if (trimmed.startsWith('#')) continue;
    if (/^[-*_](\s*[-*_]){2,}\s*$/.test(trimmed)) continue;
    if (/^\*[^*\n]+\*$/.test(trimmed)) continue;
    if (trimmed.endsWith(':')) continue;

    // Compute the inner byte range (text.slice(startByte, endByte) === blockText).
    slots.push({
      paragraphIndex,
      originalText: trimmed,
      startByte: blockStart,
      endByte: blockEnd,
    });
    paragraphIndex++;
  }
  return slots;
}

export interface ParagraphValidationResult {
  valid: boolean;
  /** Set when valid=false. Identifies which gate failed for the SlotsTab UI annotation. */
  dropReason?:
    | 'no_bullets'
    | 'no_lists'
    | 'no_tables'
    | 'no_h1'
    | 'length_under'
    | 'length_over'
    | 'zero_sentences';
}

/**
 * Symmetric ±20% length-cap ratios for `validateParagraphRewrite`. Exported so
 * `buildSequentialRewritePrompt` can show the LLM the exact bounds it must hit
 * (Phase 1b-i — investigate_sequential_paragraph_recombine_performance_20260615).
 * Single source of truth — prompt and validator MUST use the same constants to
 * prevent drift.
 */
export const PARAGRAPH_REWRITE_MIN_RATIO = 0.8;
export const PARAGRAPH_REWRITE_MAX_RATIO = 1.2;

/**
 * Pre-validate a paragraph rewrite BEFORE it consumes ranking budget. Per D7/D12 of
 * rank_individual_paragraphs_evolution_20260525.
 *
 * Symmetric ±20% length cap: `PARAGRAPH_REWRITE_MIN_RATIO <= ratio <= PARAGRAPH_REWRITE_MAX_RATIO`.
 * Widened from the prior ±10% window, which rejected ~60% of otherwise-valid rewrites in
 * staging runs (LLM rewrites routinely vary paragraph length 20-30% while staying
 * complete and well-formed). The cap still catches gross compression/expansion.
 *
 * Other gates: no bullets/lists/tables (would break article-level validateFormat after
 * recombination), no H1 (paragraphs are sub-article snippets), at least one sentence-
 * ending punctuation mark.
 */
export function validateParagraphRewrite(
  rewriteText: string,
  originalLength: number,
): ParagraphValidationResult {
  const stripped = stripCodeBlocks(rewriteText);
  if (hasBulletPoints(stripped)) return { valid: false, dropReason: 'no_bullets' };
  if (hasNumberedLists(stripped)) return { valid: false, dropReason: 'no_lists' };
  if (hasTables(stripped)) return { valid: false, dropReason: 'no_tables' };
  if (/^\s*#\s/m.test(stripped)) return { valid: false, dropReason: 'no_h1' };

  const ratio = rewriteText.length / Math.max(originalLength, 1);
  if (ratio < PARAGRAPH_REWRITE_MIN_RATIO) return { valid: false, dropReason: 'length_under' };
  if (ratio > PARAGRAPH_REWRITE_MAX_RATIO) return { valid: false, dropReason: 'length_over' };

  // Require at least one sentence-ending punctuation mark. countShortParagraphs returns 1
  // when the paragraph has < 2 sentences — but 1-sentence rewrites are fine (paragraphs can
  // be naturally short), so in that case we only reject when there's NO sentence end at all
  // (i.e. 0 sentences). Uses ≥1 rather than the article-level ≥2 threshold.
  const isShort = countShortParagraphs([rewriteText]) === 1;
  if (isShort && !/[.!?]/.test(rewriteText)) {
    return { valid: false, dropReason: 'zero_sentences' };
  }

  return { valid: true };
}

/**
 * Recombine the parent article by replacing paragraph spans with winning rewrites.
 * `slotWinners` maps `paragraphIndex` to the winning text (the original is also a
 * valid winner — passed through unchanged in that case). Paragraphs not in the map
 * stay at their original text.
 *
 * Right-to-left splice (sorted by `startByte` descending) so earlier slots' byte
 * offsets stay valid as later slots are replaced. Mirrors the splice primitive in
 * applyAcceptedGroups.ts.
 */
export function assembleRecombinedArticle(
  parentText: string,
  slots: ParagraphSlot[],
  slotWinners: Map<number, string>,
): string {
  // Replace right-to-left so earlier byte offsets aren't invalidated by later splices.
  const sortedSlots = [...slots].sort((a, b) => b.startByte - a.startByte);
  let result = parentText;
  for (const slot of sortedSlots) {
    const winner = slotWinners.get(slot.paragraphIndex);
    if (winner === undefined) continue; // Not in map → keep original.
    result = result.slice(0, slot.startByte) + winner + result.slice(slot.endByte);
  }
  return result;
}
