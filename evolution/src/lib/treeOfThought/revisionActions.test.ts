// Unit tests for revision action selection and prompt construction.

import { selectRevisionActions, buildRevisionPrompt } from './revisionActions';
import type { Critique } from '../types';
import type { RevisionActionType } from './types';

function makeCritique(scores: Record<string, number>): Critique {
  return {
    variationId: 'test-v',
    dimensionScores: scores,
    goodExamples: {},
    badExamples: { clarity: ['vague phrasing'] },
    notes: { clarity: 'Some passive voice' },
    reviewer: 'llm',
  };
}

describe('selectRevisionActions', () => {
  it('returns branchingFactor actions', () => {
    const critique = makeCritique({ clarity: 5, structure: 7, engagement: 6 });
    const actions = selectRevisionActions(critique, 3);
    expect(actions).toHaveLength(3);
  });

  it('first action is always edit_dimension targeting weakest dimension', () => {
    const critique = makeCritique({ clarity: 5, structure: 7, engagement: 3 });
    const actions = selectRevisionActions(critique, 3);
    expect(actions[0].type).toBe('edit_dimension');
    expect(actions[0].dimension).toBe('engagement');
  });

  it('enforces action-type diversity (no duplicates)', () => {
    const critique = makeCritique({ clarity: 5, structure: 7 });
    const actions = selectRevisionActions(critique, 4);
    const types = actions.map((a) => a.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('respects branchingFactor = 1 (only edit_dimension)', () => {
    const critique = makeCritique({ clarity: 5 });
    const actions = selectRevisionActions(critique, 1);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('edit_dimension');
  });

  it('respects branchingFactor = 5 (all action types)', () => {
    const critique = makeCritique({ clarity: 5, structure: 7 });
    const actions = selectRevisionActions(critique, 5);
    expect(actions).toHaveLength(5);
    const types = new Set(actions.map((a) => a.type));
    expect(types).toContain('edit_dimension');
    expect(types).toContain('structural_transform');
    expect(types).toContain('lexical_simplify');
    expect(types).toContain('grounding_enhance');
    expect(types).toContain('creative');
  });

  it('includes score in edit_dimension description', () => {
    const critique = makeCritique({ clarity: 4 });
    const actions = selectRevisionActions(critique, 1);
    expect(actions[0].description).toContain('4/10');
  });

  it('uses weakestDimensionOverride for first slot when provided', () => {
    const critique = makeCritique({ clarity: 3, engagement: 7, precision: 5 });
    const actions = selectRevisionActions(critique, 3, 'local_cohesion');
    expect(actions[0].type).toBe('edit_dimension');
    expect(actions[0].dimension).toBe('local_cohesion');
    expect(actions[0].description).toContain('flow-aware target');
  });

  it('falls back to weakest critique dimension when no override', () => {
    const critique = makeCritique({ clarity: 3, engagement: 7, precision: 5 });
    const actions = selectRevisionActions(critique, 3);
    expect(actions[0].type).toBe('edit_dimension');
    expect(actions[0].dimension).toBe('clarity');
  });

  it('override does not affect remaining action diversity', () => {
    const critique = makeCritique({ clarity: 3 });
    const actions = selectRevisionActions(critique, 4, 'transition_quality');
    const types = actions.map((a) => a.type);
    // First is edit_dimension, rest are diverse
    expect(types[0]).toBe('edit_dimension');
    expect(new Set(types).size).toBe(types.length);
  });
});

describe('buildRevisionPrompt', () => {
  const sampleText = '# Test\n\n## Section\n\nSome content here. More content here.';

  it('builds edit_dimension prompt with dimension name', () => {
    const prompt = buildRevisionPrompt(sampleText, {
      type: 'edit_dimension',
      dimension: 'clarity',
      description: 'Improve clarity (score: 5/10)',
    });
    expect(prompt).toContain('CLARITY');
    expect(prompt).toContain('surgical writing editor');
    expect(prompt).toContain('FORMAT RULES');
    expect(prompt).toContain(sampleText);
  });

  it('builds structural_transform prompt', () => {
    const prompt = buildRevisionPrompt(sampleText, {
      type: 'structural_transform',
      description: 'Restructure',
    });
    expect(prompt).toContain('structure and organization');
    expect(prompt).toContain('FORMAT RULES');
  });

  it('builds lexical_simplify prompt', () => {
    const prompt = buildRevisionPrompt(sampleText, {
      type: 'lexical_simplify',
      description: 'Simplify',
    });
    expect(prompt).toContain('plain language');
  });

  it('builds grounding_enhance prompt', () => {
    const prompt = buildRevisionPrompt(sampleText, {
      type: 'grounding_enhance',
      description: 'Add examples',
    });
    expect(prompt).toContain('evidence and examples');
  });

  it('builds creative prompt', () => {
    const prompt = buildRevisionPrompt(sampleText, {
      type: 'creative',
      description: 'Rethink',
    });
    expect(prompt).toContain('creative writing editor');
    expect(prompt).toContain('opening hook');
  });

  it('includes friction spots in prompt when provided', () => {
    const prompt = buildRevisionPrompt(
      sampleText,
      { type: 'edit_dimension', dimension: 'clarity', description: 'Improve clarity' },
      ['weak intro', 'missing examples'],
    );
    expect(prompt).toContain('Known Friction Points');
    expect(prompt).toContain('- weak intro');
    expect(prompt).toContain('- missing examples');
  });

  it('includes friction spots in all prompt types', () => {
    const types: RevisionActionType[] = [
      'edit_dimension', 'structural_transform', 'lexical_simplify',
      'grounding_enhance', 'creative',
    ];
    for (const type of types) {
      const prompt = buildRevisionPrompt(
        sampleText,
        { type, description: 'test', dimension: 'clarity' },
        ['friction issue'],
      );
      expect(prompt).toContain('friction issue');
    }
  });

  it('omits friction section when no spots provided', () => {
    const prompt = buildRevisionPrompt(sampleText, {
      type: 'edit_dimension',
      dimension: 'clarity',
      description: 'Improve clarity',
    });
    expect(prompt).not.toContain('Known Friction Points');
  });

  it('omits friction section for empty array', () => {
    const prompt = buildRevisionPrompt(
      sampleText,
      { type: 'structural_transform', description: 'Restructure' },
      [],
    );
    expect(prompt).not.toContain('Known Friction Points');
  });

  it('all prompts include FORMAT_RULES', () => {
    const types: RevisionActionType[] = [
      'edit_dimension', 'structural_transform', 'lexical_simplify',
      'grounding_enhance', 'creative',
    ];
    for (const type of types) {
      const prompt = buildRevisionPrompt(sampleText, { type, description: 'test', dimension: 'clarity' });
      expect(prompt).toContain('OUTPUT FORMAT RULES');
    }
  });
});
