// rebuild_coherence_pass_agent_mode_ab_configurable_20260624.
//
// Tests for the Mode B (rewrite-then-diff) coherence-pass proposer prompt.
// Verifies: ## Rationale / ## Rewrite headings, voice-restoration scope, the
// AMBITIOUS_DIRECTIVE prepend, the "Look for in particular" coherence focus
// list, LENGTH_HINT presence, and the absence of any CriticMarkup-syntax
// language (Mode B is rewrite-only — markup is derived downstream).

import {
  buildCoherencePassProposerSystemPromptModeB,
  buildCoherencePassProposerUserPromptModeB,
} from './buildCoherencePassProposerPromptModeB';

describe('buildCoherencePassProposerSystemPromptModeB', () => {
  const prompt = buildCoherencePassProposerSystemPromptModeB();

  describe('Mode B format spec', () => {
    it('declares the ## Rationale heading', () => {
      expect(prompt).toMatch(/## Rationale/);
    });

    it('declares the ## Rewrite heading', () => {
      expect(prompt).toMatch(/## Rewrite/);
    });

    it('requires the Rewrite section to contain the entire article body', () => {
      expect(prompt).toMatch(/MUST contain the entire article/);
    });

    it('forbids CriticMarkup in the rewrite output', () => {
      expect(prompt).toMatch(/no\s+CriticMarkup/i);
    });
  });

  describe('voice-restoration scope (coherence pass framing)', () => {
    it('opens with the "assembled from paragraphs rewritten independently in parallel" prepend', () => {
      expect(prompt).toMatch(/assembled from paragraphs rewritten\s+independently in parallel/);
    });

    it('calls out voice and cadence as the targets', () => {
      expect(prompt).toMatch(/voice/i);
      expect(prompt).toMatch(/cadence/i);
    });

    it('says substantive structural and voice-restoration rewrites are wanted', () => {
      expect(prompt).toMatch(/substantive structural and voice-restoration rewrites/);
    });
  });

  describe('coherence focus hint (Look for in particular)', () => {
    it('lists the four diagnostic patterns', () => {
      expect(prompt).toMatch(/Look for in particular/);
      expect(prompt).toMatch(/start abruptly with no transition/);
      expect(prompt).toMatch(/rhetorical hooks/);
      expect(prompt).toMatch(/voice register/);
      expect(prompt).toMatch(/repeated explanations of the same concept/);
    });
  });

  describe('ambitious-rewrite language', () => {
    it('explicitly removes the edit budget', () => {
      expect(prompt).toMatch(/no edit\s+budget/i);
    });

    it('encourages large structural rewrites', () => {
      expect(prompt).toMatch(/large structural rewrites/i);
    });

    it('describes the reviewer as seeing the rewrite as independent edit diffs', () => {
      expect(prompt).toMatch(/sequence of independent\s+edit diffs/);
    });
  });

  describe('length hint', () => {
    it('mentions the ~10% growth ceiling', () => {
      expect(prompt).toMatch(/~10%/);
    });
  });

  describe('preservation rules', () => {
    it('preserves quotes, citations, URLs', () => {
      expect(prompt).toMatch(/Preserve quotes, citations, and URLs/);
    });

    it('does not introduce or modify headings', () => {
      expect(prompt).toMatch(/Do not introduce new headings/);
    });

    it('does not edit text inside code fences', () => {
      expect(prompt).toMatch(/code fences/);
    });
  });

  describe('NEGATIVE — Mode A artifacts must be absent', () => {
    it('does NOT contain CriticMarkup insertion syntax', () => {
      expect(prompt).not.toMatch(/\{\+\+/);
    });

    it('does NOT contain CriticMarkup deletion syntax', () => {
      expect(prompt).not.toMatch(/\{--/);
    });

    it('does NOT contain CriticMarkup substitution syntax', () => {
      expect(prompt).not.toMatch(/\{~~/);
    });

    it('does NOT contain "AT MOST" count language', () => {
      expect(prompt).not.toMatch(/AT MOST/i);
    });

    it('does NOT contain "atomic edits" count language', () => {
      expect(prompt).not.toMatch(/atomic edits/i);
    });

    it('does NOT contain "edit budget" count language as a cap', () => {
      // "no edit budget" is allowed (it explicitly REMOVES the cap); a positive cap
      // would say something like "your edit budget is N" — guard against that.
      expect(prompt).not.toMatch(/edit budget is \d/i);
    });

    it('does NOT contain HARD CONSTRAINT byte-equality language (those are Mode A only)', () => {
      expect(prompt).not.toMatch(/HARD CONSTRAINT/);
      expect(prompt).not.toMatch(/byte-equality/i);
      expect(prompt).not.toMatch(/RULE 1.*outside-markup fidelity/);
      expect(prompt).not.toMatch(/RULE 2.*old-side fidelity/);
    });
  });
});

describe('buildCoherencePassProposerUserPromptModeB', () => {
  it('wraps the recombined article in <source> tags', () => {
    const out = buildCoherencePassProposerUserPromptModeB('Article body here.');
    expect(out).toContain('<source>\nArticle body here.\n</source>');
  });

  it('instructs the LLM to use the two-section format', () => {
    const out = buildCoherencePassProposerUserPromptModeB('x');
    expect(out).toMatch(/## Rationale/);
    expect(out).toMatch(/## Rewrite/);
  });

  it('mentions voice-restoration and structural-repair edits', () => {
    const out = buildCoherencePassProposerUserPromptModeB('x');
    expect(out).toMatch(/voice-restoration/);
    expect(out).toMatch(/structural-repair/);
  });
});
