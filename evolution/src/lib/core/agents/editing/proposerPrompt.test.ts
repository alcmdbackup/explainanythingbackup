import { buildProposerSystemPrompt, buildProposerUserPrompt } from './proposerPrompt';

describe('buildProposerSystemPrompt', () => {
  let prompt: string;
  beforeAll(() => { prompt = buildProposerSystemPrompt(); });

  it('embeds the soft rules', () => {
    expect(prompt.toLowerCase()).toMatch(/soft rules/);
    expect(prompt).toMatch(/quotes/i);
    expect(prompt).toMatch(/citations/i);
    expect(prompt).toMatch(/heading/i);
    expect(prompt).toMatch(/voice/i);
  });

  it('documents the markup forms', () => {
    // Insertion / deletion / substitution (inline + paired). [#N] is optional.
    expect(prompt).toMatch(/\{\+\+ inserted/);
    expect(prompt).toMatch(/\{-- deleted/);
    expect(prompt).toMatch(/\{~~ old text ~> new text ~~\}/);
    expect(prompt).toMatch(/\{~~ old text ~~\}\{\+\+ new text \+\+\}/);
  });

  it('explains adjacency-based grouping', () => {
    expect(prompt.toLowerCase()).toMatch(/adjacent|adjacency/);
    expect(prompt.toLowerCase()).toMatch(/group|groups/);
  });

  it('mentions [#N] only as an optional override', () => {
    expect(prompt).toMatch(/\[#N\]/);
    expect(prompt.toLowerCase()).toMatch(/optional/);
  });

  it('warns about whitespace fidelity outside markup spans', () => {
    expect(prompt).toMatch(/markup/i);
    expect(prompt).toMatch(/(verbatim|stripped|outside)/i);
  });

  it('does not include the article body (that is in the user prompt)', () => {
    // Sanity check — system prompt is content-agnostic.
    expect(prompt).not.toMatch(/Article to edit/i);
  });
});

describe('buildProposerUserPrompt', () => {
  it('echoes the article body verbatim', () => {
    const body = 'Hello world.';
    const p = buildProposerUserPrompt(body);
    expect(p).toContain(body);
  });

  it('handles empty input', () => {
    expect(typeof buildProposerUserPrompt('')).toBe('string');
  });
});
