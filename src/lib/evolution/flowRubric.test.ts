// Unit tests for flowRubric — shared dimension constants, prompt builders, parsers, and helpers.

import {
  QUALITY_DIMENSIONS,
  FLOW_DIMENSIONS,
  buildFlowComparisonPrompt,
  parseFlowComparisonResponse,
  buildFlowCritiquePrompt,
  parseFlowCritiqueResponse,
  buildQualityCritiquePrompt,
  normalizeScore,
  getFlowCritiqueForVariant,
  getWeakestDimensionAcrossCritiques,
} from './flowRubric';
import type { Critique } from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

describe('QUALITY_DIMENSIONS', () => {
  it('has exactly 5 dimensions', () => {
    expect(Object.keys(QUALITY_DIMENSIONS)).toHaveLength(5);
  });

  it('contains expected dimension keys', () => {
    const keys = Object.keys(QUALITY_DIMENSIONS);
    expect(keys).toContain('clarity');
    expect(keys).toContain('engagement');
    expect(keys).toContain('precision');
    expect(keys).toContain('voice_fidelity');
    expect(keys).toContain('conciseness');
  });

  it('does not contain dropped dimensions', () => {
    const keys = Object.keys(QUALITY_DIMENSIONS);
    expect(keys).not.toContain('structure');
    expect(keys).not.toContain('coherence');
    expect(keys).not.toContain('flow');
  });

  it('has string descriptions for all dimensions', () => {
    for (const desc of Object.values(QUALITY_DIMENSIONS)) {
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(10);
    }
  });
});

describe('FLOW_DIMENSIONS', () => {
  it('has exactly 5 dimensions', () => {
    expect(Object.keys(FLOW_DIMENSIONS)).toHaveLength(5);
  });

  it('contains expected flow dimension keys', () => {
    const keys = Object.keys(FLOW_DIMENSIONS);
    expect(keys).toContain('local_cohesion');
    expect(keys).toContain('global_coherence');
    expect(keys).toContain('transition_quality');
    expect(keys).toContain('rhythm_variety');
    expect(keys).toContain('redundancy');
  });

  it('has string descriptions for all dimensions', () => {
    for (const desc of Object.values(FLOW_DIMENSIONS)) {
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(10);
    }
  });
});

// ─── Flow Comparison Prompt ──────────────────────────────────────────────────

describe('buildFlowComparisonPrompt', () => {
  it('includes both texts', () => {
    const prompt = buildFlowComparisonPrompt('Text A content', 'Text B content');
    expect(prompt).toContain('Text A content');
    expect(prompt).toContain('Text B content');
  });

  it('includes all 5 flow dimensions', () => {
    const prompt = buildFlowComparisonPrompt('A', 'B');
    for (const dim of Object.keys(FLOW_DIMENSIONS)) {
      expect(prompt).toContain(dim);
    }
  });

  it('includes friction spot instructions', () => {
    const prompt = buildFlowComparisonPrompt('A', 'B');
    expect(prompt).toContain('FRICTION_A');
    expect(prompt).toContain('FRICTION_B');
  });

  it('includes OVERALL_WINNER and CONFIDENCE', () => {
    const prompt = buildFlowComparisonPrompt('A', 'B');
    expect(prompt).toContain('OVERALL_WINNER');
    expect(prompt).toContain('CONFIDENCE');
  });
});

// ─── Flow Comparison Parser ──────────────────────────────────────────────────

describe('parseFlowComparisonResponse', () => {
  const VALID_RESPONSE = `local_cohesion: A
global_coherence: B
transition_quality: A
rhythm_variety: TIE
redundancy: A
FRICTION_A: ["This leads to better outcomes."]
FRICTION_B: ["Moving on to the next topic.", "However the results show."]
OVERALL_WINNER: A
CONFIDENCE: high`;

  it('parses valid response with all dimensions', () => {
    const result = parseFlowComparisonResponse(VALID_RESPONSE);
    expect(result.winner).toBe('A');
    expect(result.confidence).toBe(1.0);
    expect(result.dimensionScores.local_cohesion).toBe('A');
    expect(result.dimensionScores.global_coherence).toBe('B');
    expect(result.dimensionScores.transition_quality).toBe('A');
    expect(result.dimensionScores.rhythm_variety).toBe('TIE');
    expect(result.dimensionScores.redundancy).toBe('A');
  });

  it('parses friction spots', () => {
    const result = parseFlowComparisonResponse(VALID_RESPONSE);
    expect(result.frictionSpotsA).toEqual(['This leads to better outcomes.']);
    expect(result.frictionSpotsB).toEqual(['Moving on to the next topic.', 'However the results show.']);
  });

  it('derives winner from dimension majority when OVERALL_WINNER missing', () => {
    const response = `local_cohesion: A
global_coherence: B
transition_quality: A
rhythm_variety: A
redundancy: TIE`;
    const result = parseFlowComparisonResponse(response);
    expect(result.winner).toBe('A');
  });

  it('returns TIE when dimensions are evenly split', () => {
    const response = `local_cohesion: A
global_coherence: B
transition_quality: TIE
rhythm_variety: TIE
redundancy: TIE`;
    const result = parseFlowComparisonResponse(response);
    expect(result.winner).toBe('TIE');
  });

  it('handles empty response', () => {
    const result = parseFlowComparisonResponse('');
    expect(result.winner).toBeNull();
    expect(result.dimensionScores).toEqual({});
    expect(result.frictionSpotsA).toEqual([]);
    expect(result.frictionSpotsB).toEqual([]);
  });

  it('handles malformed friction arrays gracefully', () => {
    const response = `local_cohesion: A
FRICTION_A: not a json array "but has quotes"
OVERALL_WINNER: A
CONFIDENCE: medium`;
    const result = parseFlowComparisonResponse(response);
    expect(result.frictionSpotsA).toEqual(['but has quotes']);
    expect(result.confidence).toBe(0.7);
  });

  it('parses low confidence', () => {
    const response = `OVERALL_WINNER: B
CONFIDENCE: low`;
    const result = parseFlowComparisonResponse(response);
    expect(result.confidence).toBe(0.5);
  });
});

// ─── Flow Critique Prompt ────────────────────────────────────────────────────

describe('buildFlowCritiquePrompt', () => {
  it('includes the text', () => {
    const prompt = buildFlowCritiquePrompt('Some article text');
    expect(prompt).toContain('Some article text');
  });

  it('includes all flow dimensions', () => {
    const prompt = buildFlowCritiquePrompt('text');
    for (const dim of Object.keys(FLOW_DIMENSIONS)) {
      expect(prompt).toContain(dim);
    }
  });

  it('specifies 0-5 scoring', () => {
    const prompt = buildFlowCritiquePrompt('text');
    expect(prompt).toContain('0-5');
  });

  it('requests friction sentences', () => {
    const prompt = buildFlowCritiquePrompt('text');
    expect(prompt).toContain('friction_sentences');
  });
});

// ─── Flow Critique Parser ────────────────────────────────────────────────────

describe('parseFlowCritiqueResponse', () => {
  it('parses valid JSON response', () => {
    const response = JSON.stringify({
      scores: { local_cohesion: 4, global_coherence: 3, transition_quality: 2, rhythm_variety: 5, redundancy: 1 },
      friction_sentences: { local_cohesion: ['Bad sentence here.'], rhythm_variety: [] },
    });
    const result = parseFlowCritiqueResponse(response);
    expect(result).not.toBeNull();
    expect(result!.scores.local_cohesion).toBe(4);
    expect(result!.scores.redundancy).toBe(1);
    expect(result!.frictionSentences.local_cohesion).toEqual(['Bad sentence here.']);
  });

  it('clamps scores to [0, 5]', () => {
    const response = JSON.stringify({
      scores: { local_cohesion: 7, global_coherence: -2 },
    });
    const result = parseFlowCritiqueResponse(response);
    expect(result).not.toBeNull();
    expect(result!.scores.local_cohesion).toBe(5);
    expect(result!.scores.global_coherence).toBe(0);
  });

  it('handles JSON wrapped in markdown fences', () => {
    const response = '```json\n' + JSON.stringify({
      scores: { local_cohesion: 3 },
      friction_sentences: {},
    }) + '\n```';
    const result = parseFlowCritiqueResponse(response);
    expect(result).not.toBeNull();
    expect(result!.scores.local_cohesion).toBe(3);
  });

  it('returns null for malformed response', () => {
    expect(parseFlowCritiqueResponse('not json')).toBeNull();
  });

  it('returns null for missing scores', () => {
    expect(parseFlowCritiqueResponse(JSON.stringify({ friction_sentences: {} }))).toBeNull();
  });

  it('handles friction_sentences as strings instead of arrays', () => {
    const response = JSON.stringify({
      scores: { local_cohesion: 3 },
      friction_sentences: { local_cohesion: 'Single sentence.' },
    });
    const result = parseFlowCritiqueResponse(response);
    expect(result).not.toBeNull();
    expect(result!.frictionSentences.local_cohesion).toEqual(['Single sentence.']);
  });

  it('filters non-string entries from friction arrays', () => {
    const response = JSON.stringify({
      scores: { local_cohesion: 3 },
      friction_sentences: { local_cohesion: ['Valid.', 42, '', null, 'Also valid.'] },
    });
    const result = parseFlowCritiqueResponse(response);
    expect(result).not.toBeNull();
    expect(result!.frictionSentences.local_cohesion).toEqual(['Valid.', 'Also valid.']);
  });
});

// ─── Quality Critique Prompt ─────────────────────────────────────────────────

describe('buildQualityCritiquePrompt', () => {
  it('includes all quality dimensions', () => {
    const prompt = buildQualityCritiquePrompt('text');
    for (const dim of Object.keys(QUALITY_DIMENSIONS)) {
      expect(prompt).toContain(dim);
    }
  });

  it('specifies 1-10 scoring', () => {
    const prompt = buildQualityCritiquePrompt('text');
    expect(prompt).toContain('1-10');
  });
});

// ─── normalizeScore ──────────────────────────────────────────────────────────

describe('normalizeScore', () => {
  it('normalizes quality scores (1-10) correctly', () => {
    expect(normalizeScore(1, '1-10')).toBeCloseTo(0.0);
    expect(normalizeScore(10, '1-10')).toBeCloseTo(1.0);
    expect(normalizeScore(5.5, '1-10')).toBeCloseTo(0.5);
  });

  it('normalizes flow scores (0-5) correctly', () => {
    expect(normalizeScore(0, '0-5')).toBeCloseTo(0.0);
    expect(normalizeScore(5, '0-5')).toBeCloseTo(1.0);
    expect(normalizeScore(2.5, '0-5')).toBeCloseTo(0.5);
  });

  it('clamps out-of-range quality scores', () => {
    expect(normalizeScore(0, '1-10')).toBe(0); // below min → clamped to 0
    expect(normalizeScore(11, '1-10')).toBe(1); // above max → clamped to 1
  });

  it('clamps out-of-range flow scores', () => {
    expect(normalizeScore(-1, '0-5')).toBe(0);
    expect(normalizeScore(6, '0-5')).toBe(1);
  });

  it('quality 3/10 < flow 4/5 after normalization', () => {
    const qualityNorm = normalizeScore(3, '1-10'); // (3-1)/9 ≈ 0.222
    const flowNorm = normalizeScore(4, '0-5');     // 4/5 = 0.8
    expect(qualityNorm).toBeLessThan(flowNorm);
  });
});

// ─── getFlowCritiqueForVariant ───────────────────────────────────────────────

describe('getFlowCritiqueForVariant', () => {
  const qualityCritique: Critique = {
    variationId: 'v1',
    dimensionScores: { clarity: 8 },
    goodExamples: {}, badExamples: {}, notes: {},
    reviewer: 'llm',
    scale: '1-10',
  };

  const flowCritique: Critique = {
    variationId: 'v1',
    dimensionScores: { local_cohesion: 3 },
    goodExamples: {}, badExamples: {}, notes: {},
    reviewer: 'llm',
    scale: '0-5',
  };

  it('finds flow critique by variant id and scale', () => {
    const result = getFlowCritiqueForVariant('v1', [qualityCritique, flowCritique]);
    expect(result).toBe(flowCritique);
  });

  it('returns undefined when no flow critique exists', () => {
    const result = getFlowCritiqueForVariant('v1', [qualityCritique]);
    expect(result).toBeUndefined();
  });

  it('returns undefined for wrong variant id', () => {
    const result = getFlowCritiqueForVariant('v2', [qualityCritique, flowCritique]);
    expect(result).toBeUndefined();
  });

  it('returns undefined for old critiques without scale field', () => {
    const oldCritique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 8 },
      goodExamples: {}, badExamples: {}, notes: {},
      reviewer: 'llm',
      // no scale field — legacy checkpoint
    };
    const result = getFlowCritiqueForVariant('v1', [oldCritique]);
    expect(result).toBeUndefined();
  });
});

// ─── getWeakestDimensionAcrossCritiques ──────────────────────────────────────

describe('getWeakestDimensionAcrossCritiques', () => {
  it('finds weakest quality dimension when no flow critique', () => {
    const qualityCritique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 8, engagement: 3, precision: 7 },
      goodExamples: {}, badExamples: {}, notes: {},
      reviewer: 'llm',
      scale: '1-10',
    };
    const result = getWeakestDimensionAcrossCritiques(qualityCritique);
    expect(result).not.toBeNull();
    expect(result!.dimension).toBe('engagement');
    expect(result!.source).toBe('quality');
  });

  it('finds flow dimension when it is weaker than quality', () => {
    const qualityCritique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 8, engagement: 7 }, // normalized: ~0.78, ~0.67
      goodExamples: {}, badExamples: {}, notes: {},
      reviewer: 'llm',
      scale: '1-10',
    };
    const flowCritique: Critique = {
      variationId: 'v1',
      dimensionScores: { local_cohesion: 1, global_coherence: 4 }, // normalized: 0.2, 0.8
      goodExamples: {}, badExamples: {}, notes: {},
      reviewer: 'llm',
      scale: '0-5',
    };
    const result = getWeakestDimensionAcrossCritiques(qualityCritique, flowCritique);
    expect(result).not.toBeNull();
    expect(result!.dimension).toBe('local_cohesion');
    expect(result!.source).toBe('flow');
    expect(result!.normalizedScore).toBeCloseTo(0.2);
  });

  it('quality dimension wins when it is weaker than flow', () => {
    const qualityCritique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 2 }, // normalized: (2-1)/9 ≈ 0.111
      goodExamples: {}, badExamples: {}, notes: {},
      reviewer: 'llm',
      scale: '1-10',
    };
    const flowCritique: Critique = {
      variationId: 'v1',
      dimensionScores: { local_cohesion: 3 }, // normalized: 3/5 = 0.6
      goodExamples: {}, badExamples: {}, notes: {},
      reviewer: 'llm',
      scale: '0-5',
    };
    const result = getWeakestDimensionAcrossCritiques(qualityCritique, flowCritique);
    expect(result).not.toBeNull();
    expect(result!.dimension).toBe('clarity');
    expect(result!.source).toBe('quality');
  });

  it('returns null for empty dimension scores', () => {
    const qualityCritique: Critique = {
      variationId: 'v1',
      dimensionScores: {},
      goodExamples: {}, badExamples: {}, notes: {},
      reviewer: 'llm',
    };
    expect(getWeakestDimensionAcrossCritiques(qualityCritique)).toBeNull();
  });

  it('defaults scale to 1-10 when absent on quality critique', () => {
    const qualityCritique: Critique = {
      variationId: 'v1',
      dimensionScores: { clarity: 1 }, // should normalize as (1-1)/9 = 0
      goodExamples: {}, badExamples: {}, notes: {},
      reviewer: 'llm',
      // no scale — defaults to '1-10'
    };
    const result = getWeakestDimensionAcrossCritiques(qualityCritique);
    expect(result).not.toBeNull();
    expect(result!.normalizedScore).toBeCloseTo(0.0);
  });
});
