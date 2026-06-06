// Unit tests for buildPromptEditorPrompt: verifies article + paragraph prompt assembly and that
// editable parts pass through verbatim while the format scaffolding is preserved.

import { buildPromptEditorPrompt } from './buildPromptEditorPrompt';

describe('buildPromptEditorPrompt', () => {
  describe('article unit', () => {
    it('includes preamble, source text, instructions, and FORMAT_RULES', () => {
      const prompt = buildPromptEditorPrompt('article', 'The original article body.', {
        preamble: 'You are an expert editor.',
        instructions: 'Restructure aggressively.',
      });
      expect(prompt).toContain('You are an expert editor.');
      expect(prompt).toContain('The original article body.');
      expect(prompt).toContain('Restructure aggressively.');
      // FORMAT_RULES is auto-appended by buildEvolutionPrompt.
      expect(prompt).toContain('OUTPUT FORMAT RULES');
      expect(prompt).toContain('## Original Text');
    });

    it('passes fully custom preamble/instructions through verbatim', () => {
      const preamble = 'CUSTOM-PREAMBLE-xyz';
      const instructions = 'CUSTOM-INSTRUCTIONS-123 rewrite as a narrative.';
      const prompt = buildPromptEditorPrompt('article', 'src', { preamble, instructions });
      expect(prompt).toContain(preamble);
      expect(prompt).toContain(instructions);
    });

    it('throws when given a paragraph spec', () => {
      expect(() =>
        buildPromptEditorPrompt('article', 'src', { directive: 'x' }),
      ).toThrow(/ArticlePromptSpec/);
    });
  });

  describe('paragraph unit', () => {
    it('wraps the directive and source paragraph in the rewrite scaffolding', () => {
      const para = 'A single source paragraph that should be rewritten in place.';
      const prompt = buildPromptEditorPrompt('paragraph', para, { directive: 'Tighten and simplify.' }, 'My Title');
      expect(prompt).toContain(para);
      expect(prompt).toContain('Tighten and simplify.');
      expect(prompt).toContain('APPROACH FOR THIS REWRITE');
      // scaffolding: paragraph rules + title context
      expect(prompt).toContain('PRESERVE MEANING');
      expect(prompt).toContain('My Title');
    });

    it('throws when given an article spec', () => {
      expect(() =>
        buildPromptEditorPrompt('paragraph', 'src', { preamble: 'a', instructions: 'b' }),
      ).toThrow(/ParagraphPromptSpec/);
    });
  });
});
