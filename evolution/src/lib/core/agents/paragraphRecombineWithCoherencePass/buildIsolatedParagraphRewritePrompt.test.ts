// Unit tests for buildIsolatedParagraphRewritePrompt + getIsolatedRewriteDirective +
// isolatedRewriteTemperature. The prompt is load-bearing: it carries the user's
// "no new content whatsoever" constraint as the primary defense (validator is
// belt-and-suspenders backup).

import {
  buildIsolatedParagraphRewritePrompt,
  getIsolatedRewriteDirective,
  isolatedRewriteTemperature,
  ISOLATED_REWRITE_DIRECTIVES,
} from './buildIsolatedParagraphRewritePrompt';

describe('ISOLATED_REWRITE_DIRECTIVES', () => {
  it('has exactly 3 directives: REORDER, TIGHTEN, RESTRUCTURE', () => {
    expect(ISOLATED_REWRITE_DIRECTIVES).toHaveLength(3);
    expect(ISOLATED_REWRITE_DIRECTIVES.map((d) => d.name)).toEqual(['REORDER', 'TIGHTEN', 'RESTRUCTURE']);
  });

  it('each directive text re-states the no-new-content prohibition', () => {
    for (const d of ISOLATED_REWRITE_DIRECTIVES) {
      const t = d.text.toLowerCase();
      expect(t).toMatch(/do not add new (definitions|sentences)/);
      expect(t).toContain('metaphors');
      expect(t).toContain('analogies');
      expect(t).toContain('examples');
    }
  });

  it('REORDER and RESTRUCTURE explicitly prohibit removing non-redundant content', () => {
    const reorder = ISOLATED_REWRITE_DIRECTIVES[0]!;
    const restructure = ISOLATED_REWRITE_DIRECTIVES[2]!;
    expect(reorder.text.toLowerCase()).toContain('do not remove any non-redundant content');
    expect(restructure.text.toLowerCase()).toContain('do not remove any non-redundant content');
  });

  it('TIGHTEN allows deleting redundant content but not non-redundant', () => {
    const tighten = ISOLATED_REWRITE_DIRECTIVES[1]!;
    const t = tighten.text.toLowerCase();
    expect(t).toContain('remove redundancy');
    expect(t).toContain('do not delete any non-redundant information');
  });
});

describe('getIsolatedRewriteDirective', () => {
  it('returns REORDER at index 0', () => {
    expect(getIsolatedRewriteDirective(0).name).toBe('REORDER');
  });
  it('returns TIGHTEN at index 1', () => {
    expect(getIsolatedRewriteDirective(1).name).toBe('TIGHTEN');
  });
  it('returns RESTRUCTURE at index 2', () => {
    expect(getIsolatedRewriteDirective(2).name).toBe('RESTRUCTURE');
  });
  it('cycles mod-3 for M > 3', () => {
    expect(getIsolatedRewriteDirective(3).name).toBe('REORDER');
    expect(getIsolatedRewriteDirective(4).name).toBe('TIGHTEN');
    expect(getIsolatedRewriteDirective(5).name).toBe('RESTRUCTURE');
  });
});

describe('isolatedRewriteTemperature', () => {
  it('returns floor at index 0 (REORDER)', () => {
    expect(isolatedRewriteTemperature(0, 0.6, 1.0, 2.0)).toBe(0.6);
  });
  it('returns midpoint at index 1 (TIGHTEN)', () => {
    expect(isolatedRewriteTemperature(1, 0.6, 1.0, 2.0)).toBe(0.8);
  });
  it('returns ceiling at index 2 (RESTRUCTURE)', () => {
    expect(isolatedRewriteTemperature(2, 0.6, 1.0, 2.0)).toBe(1.0);
  });
  it('clamps to model maxTemperature', () => {
    expect(isolatedRewriteTemperature(2, 0.6, 1.5, 1.0)).toBe(1.0);
  });
  it('returns undefined when model rejects temperature (maxTemp=null)', () => {
    expect(isolatedRewriteTemperature(0, 0.6, 1.0, null)).toBeUndefined();
  });
  it('passes value through when maxTemp is undefined (unknown model)', () => {
    expect(isolatedRewriteTemperature(1, 0.6, 1.0, undefined)).toBe(0.8);
  });
  it('cycles mod-3 — index 3 = floor, 4 = mid, 5 = ceiling', () => {
    expect(isolatedRewriteTemperature(3, 0.6, 1.0, 2.0)).toBe(0.6);
    expect(isolatedRewriteTemperature(4, 0.6, 1.0, 2.0)).toBe(0.8);
    expect(isolatedRewriteTemperature(5, 0.6, 1.0, 2.0)).toBe(1.0);
  });
});

describe('buildIsolatedParagraphRewritePrompt', () => {
  const PARAGRAPH = 'The quick brown fox jumps over the lazy dog. This sentence has thirty-eight letters.';
  const DIRECTIVE = getIsolatedRewriteDirective(0);

  it('includes the article H1 in context', () => {
    const prompt = buildIsolatedParagraphRewritePrompt('My Article Title', PARAGRAPH, 0, 5, DIRECTIVE);
    expect(prompt).toContain('My Article Title');
  });

  it('includes paragraph position', () => {
    const prompt = buildIsolatedParagraphRewritePrompt('Title', PARAGRAPH, 2, 7, DIRECTIVE);
    expect(prompt).toContain('This is paragraph 3 of 7');
  });

  it('includes the directive name + text', () => {
    const dir = getIsolatedRewriteDirective(1);
    const prompt = buildIsolatedParagraphRewritePrompt('Title', PARAGRAPH, 0, 1, dir);
    expect(prompt).toContain('TIGHTEN');
    expect(prompt).toContain(dir.text);
  });

  it('includes ABSOLUTE RULES with the no-new-content + preserve-non-redundant guards', () => {
    const prompt = buildIsolatedParagraphRewritePrompt('Title', PARAGRAPH, 0, 1, DIRECTIVE);
    expect(prompt).toContain('NO NEW CONTENT');
    expect(prompt).toContain('PRESERVE NON-REDUNDANT CONTENT');
    expect(prompt).toContain('LENGTH');
  });

  it('explicitly prohibits new definitions, metaphors, analogies, examples, factual claims', () => {
    const prompt = buildIsolatedParagraphRewritePrompt('Title', PARAGRAPH, 0, 1, DIRECTIVE);
    expect(prompt).toContain('New definitions');
    expect(prompt).toContain('New metaphors or analogies');
    expect(prompt).toContain('New examples');
    expect(prompt).toContain('New factual claims');
  });

  it('injects hard char-count floor and ceiling computed from original length', () => {
    const prompt = buildIsolatedParagraphRewritePrompt('Title', PARAGRAPH, 0, 1, DIRECTIVE);
    const originalLen = PARAGRAPH.length;
    const minChars = Math.ceil(0.85 * originalLen);
    const maxChars = Math.floor(1.20 * originalLen);
    expect(prompt).toContain(`at least ${minChars} characters`);
    expect(prompt).toContain(`at most ${maxChars} characters`);
  });

  it('includes the ORIGINAL paragraph verbatim', () => {
    const prompt = buildIsolatedParagraphRewritePrompt('Title', PARAGRAPH, 0, 1, DIRECTIVE);
    expect(prompt).toContain(PARAGRAPH);
  });

  it('ends with the REWRITTEN: marker (priming the LLM output)', () => {
    const prompt = buildIsolatedParagraphRewritePrompt('Title', PARAGRAPH, 0, 1, DIRECTIVE);
    expect(prompt.trim().endsWith('REWRITTEN:')).toBe(true);
  });

  it('different directives produce structurally distinct prompts', () => {
    const reorderPrompt = buildIsolatedParagraphRewritePrompt('T', PARAGRAPH, 0, 1, getIsolatedRewriteDirective(0));
    const tightenPrompt = buildIsolatedParagraphRewritePrompt('T', PARAGRAPH, 0, 1, getIsolatedRewriteDirective(1));
    const restructurePrompt = buildIsolatedParagraphRewritePrompt('T', PARAGRAPH, 0, 1, getIsolatedRewriteDirective(2));
    expect(reorderPrompt).not.toBe(tightenPrompt);
    expect(tightenPrompt).not.toBe(restructurePrompt);
    expect(reorderPrompt).toContain('Reorder sentences');
    expect(tightenPrompt).toContain('Tighten wording');
    expect(restructurePrompt).toContain('Restructure sentences');
  });
});
