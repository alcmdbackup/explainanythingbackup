import { buildProposerSystemPromptRewrite, buildProposerUserPromptRewrite } from './proposerPromptRewrite';

describe('buildProposerSystemPromptRewrite', () => {
  let prompt: string;
  beforeAll(() => { prompt = buildProposerSystemPromptRewrite(); });

  it('is callable with zero arguments (softCap parameter removed)', () => {
    // Compile-time + runtime guard. Previously took a softCap number argument.
    expect(buildProposerSystemPromptRewrite.length).toBe(0);
  });

  it('declares the two-section format', () => {
    expect(prompt).toMatch(/## Rationale/);
    expect(prompt).toMatch(/## Rewrite/);
  });

  it('does NOT contain the removed AT-MOST-N edit-budget language', () => {
    expect(prompt.toLowerCase()).not.toMatch(/at most \d+ distinct improvements/);
    expect(prompt.toLowerCase()).not.toMatch(/surgical changes ship/);
    expect(prompt.toLowerCase()).not.toMatch(/sprawling rewrites make the diff engine/);
  });

  it('contains the ambitious-proposal directive (no edit budget, no preference for size)', () => {
    expect(prompt.toLowerCase()).toMatch(/be ambitious/);
    expect(prompt.toLowerCase()).toMatch(/no edit budget/);
    expect(prompt.toLowerCase()).toMatch(/rewrite\s+generously\s+rather\s+than\s+sparingly/);
  });

  it('contains the granularity directive (each contiguous change is its own decision)', () => {
    expect(prompt.toLowerCase()).toMatch(/each contiguous change is its own decision/);
  });

  it('preserves the structural-protection rules (citations, headings, code fences)', () => {
    expect(prompt.toLowerCase()).toMatch(/preservation rules/);
    expect(prompt).toMatch(/citations/i);
    expect(prompt).toMatch(/heading/i);
    expect(prompt).toMatch(/code fence/i);
  });

  it('does NOT contain the removed bias-down soft rules', () => {
    expect(prompt.toLowerCase()).not.toMatch(/prefer one-sentence edits/);
    expect(prompt.toLowerCase()).not.toMatch(/voice, tone, and reading level/);
    expect(prompt.toLowerCase()).not.toMatch(/edit only when the change demonstrably improves/);
  });

  it('forbids preamble/commentary outside the article body', () => {
    expect(prompt.toLowerCase()).toMatch(/no commentary|no preamble|article only/);
  });
});

describe('buildProposerUserPromptRewrite', () => {
  it('wraps the source in <source> delimiters', () => {
    const p = buildProposerUserPromptRewrite('Hello.');
    expect(p).toContain('<source>');
    expect(p).toContain('Hello.');
    expect(p).toContain('</source>');
  });
});
