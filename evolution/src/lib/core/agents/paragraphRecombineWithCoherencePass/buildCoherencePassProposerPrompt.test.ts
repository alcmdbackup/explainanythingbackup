// Tests for the coherence-pass proposer prompt.
//
// Verifies the post-investigate_paragraph_recombine_coherence_pass_performance_20260623
// prompt: voice-restoration scope, NO edit-count cap language, NO seam-only language,
// HARD_CONSTRAINT byte-equality rules preserved, LENGTH_HINT present.

import {
  buildCoherencePassProposerSystemPrompt,
  buildCoherencePassProposerUserPrompt,
} from './buildCoherencePassProposerPrompt';

describe('buildCoherencePassProposerSystemPrompt', () => {
  const prompt = buildCoherencePassProposerSystemPrompt();

  describe('voice-restoration scope (post-investigate_paragraph_recombine_coherence_pass_performance_20260623)', () => {
    it('includes voice-restoration language', () => {
      expect(prompt).toMatch(/voice/i);
      expect(prompt).toMatch(/cadence/i);
      expect(prompt).toMatch(/restore/i);
    });

    it('authorizes substantive edits', () => {
      expect(prompt).toMatch(/AUTHORIZED to make substantive edits/i);
    });

    it('mentions whole-paragraph rewrites are allowed', () => {
      expect(prompt).toMatch(/whole-paragraph rewrites/i);
    });

    it('does NOT contain the deprecated "do NOT improve individual paragraphs" rule', () => {
      expect(prompt).not.toMatch(/do NOT improve individual paragraphs/i);
    });

    it('does NOT contain the deprecated "Edit ONLY for inter-paragraph smoothing" rule', () => {
      expect(prompt).not.toMatch(/Edit ONLY for inter-paragraph smoothing/i);
    });

    it('does NOT contain "NOT YOUR JOB" framing', () => {
      expect(prompt).not.toMatch(/NOT YOUR JOB/i);
    });
  });

  describe('NO edit-count cap (Phase 1: cap removed entirely)', () => {
    it('does NOT contain "AT MOST" language', () => {
      expect(prompt).not.toMatch(/AT MOST/);
    });

    it('does NOT contain "Edit budget" language', () => {
      expect(prompt).not.toMatch(/Edit budget/i);
    });

    it('does NOT contain "atomic edits" count caps', () => {
      // The phrase "atomic edit" appears in SYNTAX_DOCS ("each atomic edit") which is fine,
      // but should not be in the context of a count limit.
      expect(prompt).not.toMatch(/AT MOST \d+ atomic edits/i);
      expect(prompt).not.toMatch(/\d+ atomic edits per/i);
      expect(prompt).not.toMatch(/\d+-\d+ edits per/i);
    });

    it('does NOT contain "MINOR" edit framing', () => {
      expect(prompt).not.toMatch(/edits should be MINOR/i);
      expect(prompt).not.toMatch(/coherence-pass edits should be MINOR/i);
    });

    it('explicitly states no per-edit count cap', () => {
      expect(prompt).toMatch(/no per-edit count cap/i);
    });
  });

  describe('NO redundancy/flow guardrail language (Phase 2 removed both)', () => {
    it('does NOT contain "redundancy" guardrail references', () => {
      // Allow the word "dedup" or "deduplicating" since that's a valid SCOPE topic.
      // But "redundancy" or "Jaccard" or "transition word guardrail" should be absent.
      expect(prompt).not.toMatch(/Jaccard/i);
      // The deprecated rule said "deduping phrases repeated across paragraphs" — that's
      // fine as SCOPE; we're checking the proposer is not told to avoid redundancy itself.
    });

    it('does NOT instruct the proposer about transition-word preservation', () => {
      // The flow guardrail validator branch was a pre-approver filter, not a prompt
      // instruction. The prompt was already silent on the topic; verify nothing snuck in.
      expect(prompt).not.toMatch(/transition word guardrail/i);
    });
  });

  describe('LENGTH_HINT block', () => {
    it('mentions the ~10% length ceiling', () => {
      expect(prompt).toMatch(/10%/);
      expect(prompt).toMatch(/LENGTH/);
    });

    it('frames the cap as a hint, not a budget', () => {
      expect(prompt).toMatch(/may grow/i);
      expect(prompt).toMatch(/ceiling/i);
    });
  });

  describe('HARD_CONSTRAINT byte-equality rules (preserved verbatim)', () => {
    it('contains RULE 1 (outside-markup fidelity)', () => {
      expect(prompt).toMatch(/RULE 1 \(outside-markup fidelity\)/);
      expect(prompt).toMatch(/every byte OUTSIDE a \{\+\+…\+\+\}/);
    });

    it('contains RULE 2 (old-side fidelity)', () => {
      expect(prompt).toMatch(/RULE 2 \(old-side fidelity\)/);
      expect(prompt).toMatch(/the "old" side of every \{~~old~>new~~\}/);
    });

    it('contains the <output>…</output> block requirement', () => {
      expect(prompt).toMatch(/<output>…<\/output>/);
    });
  });

  describe('SOFT_RULES preserved', () => {
    it('preserves quotes/citations/URLs rule', () => {
      expect(prompt).toMatch(/Preserve quotes, citations, and URLs exactly/i);
    });

    it('preserves heading-protection rule', () => {
      expect(prompt).toMatch(/Do not introduce new headings or modify existing heading lines/i);
    });

    it('preserves code-fence rule', () => {
      expect(prompt).toMatch(/Do not edit text inside code fences/i);
    });
  });

  describe('SELF_CHECK preserved', () => {
    it('contains the byte-equality self-check', () => {
      expect(prompt).toMatch(/Self-check before responding/);
      expect(prompt).toMatch(/byte-for-byte/);
    });
  });
});

describe('buildCoherencePassProposerUserPrompt', () => {
  it('wraps the article in <source>…</source>', () => {
    const article = '# Test\n\nFirst paragraph.';
    const userPrompt = buildCoherencePassProposerUserPrompt(article);
    expect(userPrompt).toContain('<source>');
    expect(userPrompt).toContain('</source>');
    expect(userPrompt).toContain(article);
  });

  it('asks for the <output>…</output> block', () => {
    const userPrompt = buildCoherencePassProposerUserPrompt('content');
    expect(userPrompt).toMatch(/<output>…<\/output>/);
  });

  it('mentions voice-restoration in the request line', () => {
    const userPrompt = buildCoherencePassProposerUserPrompt('content');
    expect(userPrompt).toMatch(/voice/i);
  });
});
