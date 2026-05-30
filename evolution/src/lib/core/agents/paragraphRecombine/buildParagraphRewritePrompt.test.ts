// Unit tests for buildParagraphRewritePrompt + PARAGRAPH_REWRITE_DIRECTIVES.
// investigate_matchmaking_paragraph_recombine_20260528 Option A: each of the M rewrites
// gets a DISTINCT directive so they differ on a real quality axis. Assertions are on the
// constructed prompt INPUTS (the actual rewrite text comes from the LLM at temp 1–2 and
// cannot be asserted deterministically under a mock).

import { buildParagraphRewritePrompt, PARAGRAPH_REWRITE_DIRECTIVES } from './buildParagraphRewritePrompt';

describe('PARAGRAPH_REWRITE_DIRECTIVES', () => {
  it('has ≥3 distinct directives', () => {
    expect(PARAGRAPH_REWRITE_DIRECTIVES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(PARAGRAPH_REWRITE_DIRECTIVES).size).toBe(PARAGRAPH_REWRITE_DIRECTIVES.length);
  });

  it('content-additive directive constrains additions to ONE sentence (±20% length-cap safety)', () => {
    // Index 1 is the content-additive axis; it must bound the addition to one sentence so
    // the output stays within validateParagraphRewrite's ±20% window.
    expect(PARAGRAPH_REWRITE_DIRECTIVES[1]).toMatch(/\bONE\b/);
    expect(PARAGRAPH_REWRITE_DIRECTIVES[1]!.toLowerCase()).toContain('sentence');
  });

  it('tighten directive (index 0) carries an explicit lower-length floor (length_under fix)', () => {
    // investigate_paragraph_recombine_invocation_20260529: the tighten axis at low temperature
    // underflowed validateParagraphRewrite's 0.8 length floor (89% length_under drop on slot 0).
    // The directive must now pin a lower bound so the rewrite stays in the ±20% window.
    const d0 = PARAGRAPH_REWRITE_DIRECTIVES[0]!.toLowerCase();
    expect(d0).toContain('0.85');
    expect(d0).toContain('never below');
    expect(d0).toContain('substance');
  });
});

describe('buildParagraphRewritePrompt', () => {
  it('omits the APPROACH block when no directive is given (back-compat)', () => {
    const p = buildParagraphRewritePrompt('My Title', 'The original paragraph text.', 0, 5);
    expect(p).not.toContain('APPROACH FOR THIS REWRITE');
    expect(p).toContain('ORIGINAL:');
    expect(p).toContain('The original paragraph text.');
    expect(p).toContain('paragraph 1 of 5');
  });

  it('injects a distinct APPROACH block per directive → distinct prompts', () => {
    const p0 = buildParagraphRewritePrompt('My Title', 'The original paragraph text.', 0, 5, PARAGRAPH_REWRITE_DIRECTIVES[0]);
    const p1 = buildParagraphRewritePrompt('My Title', 'The original paragraph text.', 0, 5, PARAGRAPH_REWRITE_DIRECTIVES[1]);
    expect(p0).toContain('APPROACH FOR THIS REWRITE');
    expect(p0).toContain(PARAGRAPH_REWRITE_DIRECTIVES[0]);
    expect(p1).toContain(PARAGRAPH_REWRITE_DIRECTIVES[1]);
    expect(p0).not.toEqual(p1);
  });
});
