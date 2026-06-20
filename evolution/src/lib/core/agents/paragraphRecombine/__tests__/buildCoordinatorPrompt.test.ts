// Unit tests for buildCoordinatorPrompt + COORDINATOR_STRATEGIES_BLOCK shared const
// (investigate_sequential_paragraph_recombine_performance_20260615 Phase 2a + 1b-ii).

import {
  buildCoordinatorPrompt,
  COORDINATOR_STRATEGIES_BLOCK,
} from '../buildCoordinatorPrompt';

describe('buildCoordinatorPrompt', () => {
  const basePrompt = buildCoordinatorPrompt({
    parentText: 'paragraph 1.\n\nparagraph 2.',
    paragraphCount: 2,
  });

  it('interpolates parentText and paragraphCount', () => {
    expect(basePrompt).toContain('paragraph 1.');
    expect(basePrompt).toContain('PARENT ARTICLE has 2 body paragraphs');
    expect(basePrompt).toContain('exactly 2 entries total');
  });

  it('preserves the JSON OUTPUT FORMAT schema example', () => {
    expect(basePrompt).toContain('OUTPUT FORMAT');
    expect(basePrompt).toContain('"paragraphIndex": 0');
    expect(basePrompt).toContain('"role": "lede"');
    expect(basePrompt).toContain('"M": 3');
  });

  // Phase 2a — extraction regression guard. Both buildCoordinatorPrompt AND
  // buildCoordinatorReplanPrompt (added in Phase 2) must interpolate the SAME
  // COORDINATOR_STRATEGIES_BLOCK const so the two prompts cannot drift.
  describe('COORDINATOR_STRATEGIES_BLOCK shared const (Phase 2a)', () => {
    it('is interpolated verbatim into the rendered prompt', () => {
      expect(basePrompt).toContain(COORDINATOR_STRATEGIES_BLOCK);
    });

    it('contains the DIVERSITY guidance', () => {
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('AIM FOR DIVERSITY OF STRATEGIES');
    });

    it('contains the EXAMPLE STRATEGIES PER ROLE section', () => {
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('EXAMPLE STRATEGIES PER ROLE');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('Lede (paragraph 0');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('Body paragraphs');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('Closers');
    });

    it('contains the TEMPERATURE GUIDANCE section', () => {
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('TEMPERATURE GUIDANCE');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('Conservative/preserve directives');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('AVOID temperatures above 1.4');
    });

    it('contains the EMBEDDING ARTICLE-LEVEL INTENT section', () => {
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('EMBEDDING ARTICLE-LEVEL INTENT');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('Federal Open Market Committee');
    });
  });

  // Phase 1b-ii — strengthened WHEN TO SKIP block with concrete heuristics and an
  // explicit target rate. Addresses the no-op-rewrite failure mode where the
  // coordinator marked shouldRewrite=true for paragraphs whose rewrites turned out
  // near-duplicates of the seed.
  describe('WHEN TO SKIP guidance (Phase 1b-ii)', () => {
    it('contains the 5 concrete skip heuristics', () => {
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('HIGH FACT DENSITY');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('DEFINITIONAL ANCHOR');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('ALREADY-TIGHT PROSE');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('SHORT PARAGRAPH');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('RHETORICAL ANCHOR');
    });

    it('states the asymmetric-loss principle that nudges toward more skips', () => {
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain(
        'A skipped paragraph that the article-judge would have improved is a smaller loss',
      );
    });

    it('contains the explicit TARGET RATE (2-4 of 8-12 slots)', () => {
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('TARGET RATE');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('expect 2–4 slots marked shouldRewrite: false');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('If you mark 0 or 1, you are under-skipping');
      expect(COORDINATOR_STRATEGIES_BLOCK).toContain('if you mark 6+, you are giving up on the agent');
    });

    it('does NOT contain the pre-Phase-1b-ii abstract criteria (regression guard)', () => {
      // Pre-strengthening, the block had abstract bullets like "the paragraph is
      // already well-written and any change is likely to hurt" and "M=1 candidates
      // would all be near-duplicates of the original". These were too soft to fire
      // reliably. The strengthened version replaces them with concrete heuristics.
      expect(COORDINATOR_STRATEGIES_BLOCK).not.toContain(
        'M=1 candidates would all be near-duplicates of the original',
      );
    });
  });
});
