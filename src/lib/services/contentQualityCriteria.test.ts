// Unit tests for content quality evaluation criteria.
// Verifies dimension coverage and rubric structure.

import {
  DIMENSION_CRITERIA,
  DEFAULT_EVAL_DIMENSIONS,
  ALL_EVAL_DIMENSIONS,
} from './contentQualityCriteria';
import type { ContentQualityDimension } from '@/lib/schemas/schemas';

describe('DIMENSION_CRITERIA', () => {
  it('has criteria for all 8 dimensions', () => {
    const expectedDimensions: ContentQualityDimension[] = [
      'clarity', 'structure', 'engagement', 'conciseness',
      'coherence', 'specificity', 'point_of_view', 'overall',
    ];

    for (const dim of expectedDimensions) {
      expect(DIMENSION_CRITERIA[dim]).toBeDefined();
      expect(typeof DIMENSION_CRITERIA[dim]).toBe('string');
    }
  });

  it('each criteria has scoring rubric text', () => {
    for (const [dim, criteria] of Object.entries(DIMENSION_CRITERIA)) {
      expect(criteria).toContain('SCORING RUBRIC');
      expect(criteria).toContain('0.9');
      expect(criteria.length).toBeGreaterThan(100);
    }
  });

  it('each criteria has anchor examples', () => {
    // All dimensions except 'overall' should have ANCHOR EXAMPLES
    const withExamples = Object.entries(DIMENSION_CRITERIA).filter(
      ([dim]) => dim !== 'overall',
    );

    for (const [dim, criteria] of withExamples) {
      expect(criteria).toContain('ANCHOR EXAMPLES');
    }
  });

  it('anti-bias notes present where needed', () => {
    expect(DIMENSION_CRITERIA.engagement).toContain('ANTI-BIAS');
    expect(DIMENSION_CRITERIA.overall).toContain('ANTI-BIAS');
  });
});

describe('DEFAULT_EVAL_DIMENSIONS', () => {
  it('contains 4 core dimensions', () => {
    expect(DEFAULT_EVAL_DIMENSIONS).toHaveLength(4);
    expect(DEFAULT_EVAL_DIMENSIONS).toContain('clarity');
    expect(DEFAULT_EVAL_DIMENSIONS).toContain('structure');
    expect(DEFAULT_EVAL_DIMENSIONS).toContain('engagement');
    expect(DEFAULT_EVAL_DIMENSIONS).toContain('overall');
  });
});

describe('ALL_EVAL_DIMENSIONS', () => {
  it('contains all 8 dimensions', () => {
    expect(ALL_EVAL_DIMENSIONS).toHaveLength(8);
  });

  it('is a superset of DEFAULT_EVAL_DIMENSIONS', () => {
    for (const dim of DEFAULT_EVAL_DIMENSIONS) {
      expect(ALL_EVAL_DIMENSIONS).toContain(dim);
    }
  });
});
