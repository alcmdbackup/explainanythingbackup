// Unit tests for formatMetaFeedback helper.
// Verifies all 4 MetaFeedback fields, empty fields, and null input.

import { formatMetaFeedback } from './metaFeedback';
import type { MetaFeedback } from '../types';

describe('formatMetaFeedback', () => {
  it('returns null for null input', () => {
    expect(formatMetaFeedback(null)).toBeNull();
  });

  it('returns null when all arrays are empty', () => {
    const feedback: MetaFeedback = {
      priorityImprovements: [],
      recurringWeaknesses: [],
      successfulStrategies: [],
      patternsToAvoid: [],
    };
    expect(formatMetaFeedback(feedback)).toBeNull();
  });

  it('includes all 4 fields when populated', () => {
    const feedback: MetaFeedback = {
      priorityImprovements: ['improve clarity'],
      recurringWeaknesses: ['too abstract'],
      successfulStrategies: ['good examples'],
      patternsToAvoid: ['excessive jargon'],
    };
    const result = formatMetaFeedback(feedback)!;
    expect(result).toContain('## Meta-Review Feedback');
    expect(result).toContain('### Priority Improvements');
    expect(result).toContain('- improve clarity');
    expect(result).toContain('### Recurring Weaknesses to Fix');
    expect(result).toContain('- too abstract');
    expect(result).toContain('### Successful Strategies (keep doing these)');
    expect(result).toContain('- good examples');
    expect(result).toContain('### Patterns to Avoid');
    expect(result).toContain('- excessive jargon');
  });

  it('omits sections with empty arrays', () => {
    const feedback: MetaFeedback = {
      priorityImprovements: ['fix transitions'],
      recurringWeaknesses: [],
      successfulStrategies: [],
      patternsToAvoid: ['wall of text'],
    };
    const result = formatMetaFeedback(feedback)!;
    expect(result).toContain('### Priority Improvements');
    expect(result).toContain('### Patterns to Avoid');
    expect(result).not.toContain('### Recurring Weaknesses');
    expect(result).not.toContain('### Successful Strategies');
  });

  it('handles multiple items per field', () => {
    const feedback: MetaFeedback = {
      priorityImprovements: ['fix flow', 'add examples', 'simplify language'],
      recurringWeaknesses: [],
      successfulStrategies: [],
      patternsToAvoid: [],
    };
    const result = formatMetaFeedback(feedback)!;
    expect(result).toContain('- fix flow');
    expect(result).toContain('- add examples');
    expect(result).toContain('- simplify language');
  });
});
