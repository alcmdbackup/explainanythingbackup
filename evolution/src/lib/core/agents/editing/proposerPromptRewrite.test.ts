import { buildProposerSystemPromptRewrite, buildProposerUserPromptRewrite } from './proposerPromptRewrite';

describe('buildProposerSystemPromptRewrite', () => {
  let prompt: string;
  beforeAll(() => { prompt = buildProposerSystemPromptRewrite(3); });

  it('declares the two-section format', () => {
    expect(prompt).toMatch(/## Rationale/);
    expect(prompt).toMatch(/## Rewrite/);
  });

  it('mentions the soft cap from the parameter', () => {
    expect(prompt).toMatch(/AT MOST 3/);
    const five = buildProposerSystemPromptRewrite(5);
    expect(five).toMatch(/AT MOST 5/);
  });

  // meta_analysis_how_to_get_top_arena_federal_reserve_2_20260616 Phase 6:
  // soft-cap Zod range widened from 1-5 → 1-10 so the A/B can run softCap=8.
  // The prompt template must render the requested value verbatim. A future
  // refactor that clamps the rendered value to 5 would silently null the
  // experiment.
  it.each([1, 3, 5, 8, 10])('renders "AT MOST N" verbatim for softCap=%i', (n) => {
    const p = buildProposerSystemPromptRewrite(n);
    expect(p).toMatch(new RegExp(`AT MOST ${n}`));
  });

  it('preserves the soft rules (citations, headings, code fences, voice)', () => {
    expect(prompt).toMatch(/citations/i);
    expect(prompt).toMatch(/heading/i);
    expect(prompt).toMatch(/code fence/i);
    expect(prompt).toMatch(/voice/i);
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
