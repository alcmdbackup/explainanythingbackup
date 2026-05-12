// Tests for buildSinglePassCustomPromptFromSuggestions — the prompt builder
// used by single_pass_evaluate_criteria_and_generate.

import {
  buildSinglePassCustomPromptFromSuggestions,
  SINGLE_PASS_HIGH_ELO_THRESHOLD,
} from './singlePassEvaluateCriteriaAndGenerate';

const SUGGESTIONS = [
  {
    criteriaName: 'engagement',
    examplePassage: 'Some passage.',
    whatNeedsAddressing: 'Needs an analogy.',
    suggestedFix: 'Add a concrete real-world example.',
    score: 2,
    maxRating: 5,
  },
  {
    criteriaName: 'depth',
    examplePassage: 'A brief mention of monetary policy.',
    whatNeedsAddressing: 'Surface-level treatment.',
    suggestedFix: 'Expand with a mechanism walkthrough.',
    score: 3,
    maxRating: 5,
  },
];

describe('buildSinglePassCustomPromptFromSuggestions', () => {
  describe('without highEloParent flag (default behavior)', () => {
    it('emits the base prompt with all three guardrail directives', () => {
      const { preamble, instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS);
      expect(preamble).toContain('expert article reviser');
      expect(instructions).toContain('**Length**');
      expect(instructions).toContain('**Redundancy**');
      expect(instructions).toContain('**Flow**');
      expect(instructions).toContain('Do not introduce meta-commentary');
    });

    it('enumerates each suggestion with criteria name + example + fix', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS);
      expect(instructions).toContain('Issue 1 (engagement)');
      expect(instructions).toContain('Some passage.');
      expect(instructions).toContain('Add a concrete real-world example.');
      expect(instructions).toContain('Issue 2 (depth)');
      expect(instructions).toContain('Expand with a mechanism walkthrough.');
    });

    it('does NOT emit the surgical-edits / high-Elo block', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS);
      expect(instructions).not.toContain('SURGICAL EDITS ONLY');
      expect(instructions).not.toContain('Preserve the title');
      expect(instructions).not.toContain('5-15 atomic edits');
    });

    it('treats highEloParent=false the same as the absent flag', () => {
      const { instructions: a } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS);
      const { instructions: b } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: false });
      expect(a).toEqual(b);
    });
  });

  describe('with highEloParent=true (parent Elo > 1300)', () => {
    it('emits the surgical-edits block with all five directives', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: true });
      // Block header
      expect(instructions).toContain('SURGICAL EDITS ONLY');
      // Each of the 5 bullets, by its leading bold marker
      expect(instructions).toContain('Preserve the title (H1) exactly');
      expect(instructions).toContain('Preserve heading levels and section order');
      expect(instructions).toContain('Preserve bold/italic emphasis on key terms');
      expect(instructions).toContain('Prefer ADDITIVE edits');
      expect(instructions).toContain('Aim for 5-15 atomic edits');
    });

    it('inlines the threshold value in the block header', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: true });
      expect(instructions).toContain(`Elo > ${SINGLE_PASS_HIGH_ELO_THRESHOLD}`);
    });

    it('still emits the base prompt (Length/Redundancy/Flow + meta-commentary clause)', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: true });
      expect(instructions).toContain('**Length**');
      expect(instructions).toContain('**Redundancy**');
      expect(instructions).toContain('**Flow**');
      expect(instructions).toContain('Do not introduce meta-commentary');
    });

    it('places the surgical-edits block AFTER the base guardrails (so they take precedence visually)', () => {
      const { instructions } = buildSinglePassCustomPromptFromSuggestions(SUGGESTIONS, { highEloParent: true });
      const flowIdx = instructions.indexOf('**Flow**');
      const surgicalIdx = instructions.indexOf('SURGICAL EDITS ONLY');
      expect(flowIdx).toBeGreaterThan(-1);
      expect(surgicalIdx).toBeGreaterThan(flowIdx);
    });
  });

  it('exports a numeric threshold that the call-site can compare against', () => {
    expect(typeof SINGLE_PASS_HIGH_ELO_THRESHOLD).toBe('number');
    expect(SINGLE_PASS_HIGH_ELO_THRESHOLD).toBe(1300);
  });
});
