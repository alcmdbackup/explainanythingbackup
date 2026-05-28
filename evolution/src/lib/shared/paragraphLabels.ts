// Hierarchical paragraph identity labels (V8abc123.P3.R1) per D19 of
// rank_individual_paragraphs_evolution_20260525.
//
// V8abc123     = article variant (8-char UUID prefix; existing convention).
// V8abc123.P3  = paragraph slot 3 of that variant (1-based for display; 0-based in code).
// V8abc123.P3.R7 = the 7th rewrite ever for V8abc123 slot 3 (persistent ordering by
//                  created_at within the slot's arena topic).
// V8abc123.P3.original = the original paragraph variant for V8abc123 slot 3.
//
// Used everywhere: SlotsTab labels, RecombinedOutputTab annotations, log messages,
// execution_detail.slots[i].rewrites[j].label (denormalized for queryability).

export interface ParagraphLabelInput {
  /** UUID of the parent article variant (full 36-char form). */
  parentId: string;
  /** 0-based slot index. */
  slotIndex: number;
  /** 1-based rewrite order within the slot's arena topic. Undefined for the original. */
  rewriteOrder?: number;
  /** True for the original-paragraph variant. */
  isOriginal?: boolean;
}

/**
 * Format a paragraph-identity label per D19. Pure function — no DB dependency.
 *
 * The `rewriteOrder` (R-number) is intended to be computed by the caller from
 * `created_at` ordering within the slot's arena topic. The SlotsTab caches this
 * lookup once per slot selection so per-row label rendering is O(1).
 *
 * Examples:
 *   formatParagraphLabel({parentId: 'V8abc123de-...', slotIndex: 2}) => 'V8abc123.P3'
 *   formatParagraphLabel({parentId: 'V8abc123de-...', slotIndex: 2, isOriginal: true}) => 'V8abc123.P3.original'
 *   formatParagraphLabel({parentId: 'V8abc123de-...', slotIndex: 2, rewriteOrder: 7}) => 'V8abc123.P3.R7'
 */
export function formatParagraphLabel(input: ParagraphLabelInput): string {
  const { parentId, slotIndex, rewriteOrder, isOriginal } = input;
  const parentPrefix = parentId.slice(0, 8);
  const base = `${parentPrefix}.P${slotIndex + 1}`;
  if (isOriginal) return `${base}.original`;
  if (rewriteOrder !== undefined) return `${base}.R${rewriteOrder}`;
  return base;
}

/**
 * Format the arena-topic name for a paragraph slot, per D14 + D19. Used by
 * upsertSlotTopic and as the row's `evolution_prompts.prompt` value (the topic
 * identifier is also written to .name; both columns carry the same identifier
 * for paragraph topics since there's no separate natural-language prompt text).
 *
 * Example: `[para] V8abc123.P3`
 */
export function formatSlotTopicName(parentId: string, slotIndex: number, kindShort = 'para'): string {
  const parentPrefix = parentId.slice(0, 8);
  return `[${kindShort}] ${parentPrefix}.P${slotIndex + 1}`;
}
