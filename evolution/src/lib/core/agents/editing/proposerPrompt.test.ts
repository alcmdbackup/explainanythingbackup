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

  it('documents all 3 markup forms', () => {
    expect(prompt).toMatch(/\{\+\+ \[#N\]/);
    expect(prompt).toMatch(/\{-- \[#N\]/);
    expect(prompt).toMatch(/\{~~ \[#N\]/);
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
