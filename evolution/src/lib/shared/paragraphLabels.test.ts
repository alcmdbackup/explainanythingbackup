// Unit tests for paragraphLabels helpers.
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.

import { formatParagraphLabel, formatSlotTopicName } from './paragraphLabels';

const PARENT = 'v8abc123de-0000-0000-0000-000000000000';

describe('formatParagraphLabel', () => {
  it('formats a paragraph slot label', () => {
    expect(formatParagraphLabel({ parentId: PARENT, slotIndex: 2 })).toBe('v8abc123.P3');
  });

  it('formats an original-paragraph label', () => {
    expect(formatParagraphLabel({ parentId: PARENT, slotIndex: 2, isOriginal: true })).toBe('v8abc123.P3.original');
  });

  it('formats a rewrite label with the persistent R-number', () => {
    expect(formatParagraphLabel({ parentId: PARENT, slotIndex: 2, rewriteOrder: 7 })).toBe('v8abc123.P3.R7');
  });

  it('uses 1-based slot numbering for display while accepting 0-based input', () => {
    expect(formatParagraphLabel({ parentId: PARENT, slotIndex: 0 })).toBe('v8abc123.P1');
  });
});

describe('formatSlotTopicName', () => {
  it('formats the paragraph-topic identifier', () => {
    expect(formatSlotTopicName(PARENT, 2)).toBe('[para] v8abc123.P3');
  });

  it('accepts the kindShort parameter for future granularities', () => {
    expect(formatSlotTopicName(PARENT, 2, 'sent')).toBe('[sent] v8abc123.P3');
  });
});
