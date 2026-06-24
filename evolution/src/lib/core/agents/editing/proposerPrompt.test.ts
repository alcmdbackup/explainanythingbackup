import { buildProposerSystemPrompt, buildProposerUserPrompt } from './proposerPrompt';

describe('buildProposerSystemPrompt', () => {
  let prompt: string;
  beforeAll(() => { prompt = buildProposerSystemPrompt(); });

  it('embeds the preservation rules (structural protection only — not bias-down)', () => {
    expect(prompt.toLowerCase()).toMatch(/preservation rules/);
    expect(prompt).toMatch(/quotes/i);
    expect(prompt).toMatch(/citations/i);
    expect(prompt).toMatch(/heading/i);
    expect(prompt).toMatch(/code fences/i);
  });

  it('does NOT contain the removed bias-down soft rules', () => {
    expect(prompt.toLowerCase()).not.toMatch(/prefer one-sentence edits/);
    expect(prompt.toLowerCase()).not.toMatch(/voice, tone, and reading level/);
    expect(prompt.toLowerCase()).not.toMatch(/edit only when the change demonstrably improves/);
    expect(prompt.toLowerCase()).not.toMatch(/never for its own sake/);
  });

  it('contains the ambitious-proposal directive (no edit budget, no preference for size)', () => {
    expect(prompt.toLowerCase()).toMatch(/be ambitious/);
    expect(prompt.toLowerCase()).toMatch(/no edit budget/);
    expect(prompt.toLowerCase()).toMatch(/cost of withholding a useful one is\s*high/);
  });

  it('does NOT contain the removed EDIT_BUDGET soft cap language', () => {
    expect(prompt.toLowerCase()).not.toMatch(/at most 3 atomic edits/);
    expect(prompt.toLowerCase()).not.toMatch(/surgical changes ship/);
    expect(prompt.toLowerCase()).not.toMatch(/sprawling rewrites get discarded/);
  });

  it('documents the markup forms', () => {
    expect(prompt).toMatch(/\{\+\+ inserted/);
    expect(prompt).toMatch(/\{-- deleted/);
    expect(prompt).toMatch(/\{~~ old text ~> new text ~~\}/);
    expect(prompt).toMatch(/\{~~ old text ~~\}\{\+\+ new text \+\+\}/);
  });

  it('explains per-span (max granularity) grouping', () => {
    // Each unnumbered span is its own group; only paired delete+insert merges.
    expect(prompt.toLowerCase()).toMatch(/each criticmarkup span is one independent edit/);
    expect(prompt.toLowerCase()).toMatch(/maximize\s+the\s+number\s+of\s+independent\s+decisions/);
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
    expect(prompt).not.toMatch(/Article to edit/i);
  });

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

  it('self-check is concrete with numbered steps and byte-equality phrasing', () => {
    expect(prompt).toMatch(/Self-check/i);
    expect(prompt).toMatch(/1\.\s+Mentally delete/);
    expect(prompt).toMatch(/byte-for-byte|character-for-character/);
  });

  it('explicitly tells the model NOT to echo the <source> block in its response', () => {
    expect(prompt).toMatch(/do not echo the <source>|do NOT echo the <source>|no echo of the <source>/i);
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
