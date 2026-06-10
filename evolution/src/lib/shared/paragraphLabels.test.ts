// Unit tests for paragraphLabels helpers.
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.

import { formatParagraphLabel, formatSlotTopicName, parseSlotParagraphNumber } from './paragraphLabels';

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

describe('parseSlotParagraphNumber', () => {
  it('recovers the 1-based paragraph number from a slot-topic name (round-trips formatSlotTopicName)', () => {
    expect(parseSlotParagraphNumber(formatSlotTopicName(PARENT, 2))).toBe(3);
    expect(parseSlotParagraphNumber('[para] v8abc123.P1')).toBe(1);
    expect(parseSlotParagraphNumber('[para] v8abc123.P12')).toBe(12);
  });

  it('returns null for null/undefined/empty input', () => {
    expect(parseSlotParagraphNumber(null)).toBeNull();
    expect(parseSlotParagraphNumber(undefined)).toBeNull();
    expect(parseSlotParagraphNumber('')).toBeNull();
  });

  it('returns null for malformed or non-paragraph topic names', () => {
    expect(parseSlotParagraphNumber('not a topic')).toBeNull();
    expect(parseSlotParagraphNumber('[para] v8abc123')).toBeNull(); // no .P<N>
    expect(parseSlotParagraphNumber('[para] v8abc123.PX')).toBeNull(); // non-numeric
    expect(parseSlotParagraphNumber('[sent] v8abc123.P3')).toBeNull(); // wrong kind prefix
  });
});
