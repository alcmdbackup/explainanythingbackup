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

  // Phase 2 hardening assertions
  it('leads with HARD CONSTRAINT and labels both RULE 1 and RULE 2', () => {
    expect(prompt).toMatch(/HARD CONSTRAINT/);
    expect(prompt).toMatch(/RULE 1/);
    expect(prompt).toMatch(/RULE 2/);
  });

  it('includes a worked example with <source> and <output> delimiters', () => {
    expect(prompt).toMatch(/<source>/);
    expect(prompt).toMatch(/<output>/);
  });

  it('embeds paired BAD/GOOD failure-pattern micro-examples', () => {
    expect(prompt).toMatch(/PATTERN A/);
    expect(prompt).toMatch(/PATTERN B/);
    const badCount = (prompt.match(/BAD:/g) || []).length;
    const goodCount = (prompt.match(/GOOD:/g) || []).length;
    expect(badCount).toBeGreaterThanOrEqual(2);
    expect(goodCount).toBeGreaterThanOrEqual(2);
  });

  it('states the 3-edit soft cap', () => {
    expect(prompt.toLowerCase()).toMatch(/at most 3 atomic edits/);
  });

  it('self-check is concrete with numbered steps and byte-equality phrasing', () => {
    expect(prompt).toMatch(/Self-check/i);
    expect(prompt).toMatch(/1\.\s+Mentally delete/);
    expect(prompt).toMatch(/byte-for-byte|character-for-character/);
  });
});

describe('buildProposerUserPrompt', () => {
  it('wraps the article in <source>…</source> delimiters', () => {
    const body = 'Hello world.';
    const p = buildProposerUserPrompt(body);
    expect(p).toContain('<source>');
    expect(p).toContain('</source>');
    expect(p).toContain(body);
  });

  it('asks for the response inside <output>', () => {
    const p = buildProposerUserPrompt('test');
    expect(p).toMatch(/<output>/);
  });

  it('handles empty input', () => {
    expect(typeof buildProposerUserPrompt('')).toBe('string');
  });
});
