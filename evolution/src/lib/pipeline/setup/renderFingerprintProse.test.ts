// Tests for renderFingerprintProse — deterministic prose from traits, with scope-specific
// signature-phrase handling (article includes the anti-overuse directive; paragraph omits it).

import { renderFingerprintProse } from './renderFingerprintProse';
import { styleFingerprintTraitsSchema, type StyleFingerprintTraits } from '../../schemas';

const TRAITS: StyleFingerprintTraits = {
  sentenceLength: { avgWords: 11.4, distribution: 'short, declarative' },
  spellingRegion: 'american',
  vocabularyLevel: 'plain, concrete',
  tone: ['terse', 'plain'],
  signaturePhrases: [
    { phrase: 'and so', frequency: 'occasional' },
    { phrase: 'it was good', frequency: 'rare' },
  ],
  structuralHabits: ['few subordinate clauses'],
  punctuationHabits: ['sparse commas'],
  summary: 'A terse, declarative voice.',
};

describe('renderFingerprintProse', () => {
  it('includes core traits in both scopes', () => {
    for (const scope of ['article', 'paragraph'] as const) {
      const out = renderFingerprintProse(TRAITS, scope);
      expect(out).toContain('11 words'); // rounded avgWords
      expect(out).toContain('american');
      expect(out).toContain('terse');
      expect(out).toContain('A terse, declarative voice.');
    }
  });

  it('article scope includes the anti-overuse directive and signature phrases', () => {
    const out = renderFingerprintProse(TRAITS, 'article');
    expect(out).toContain('SPARINGLY');
    expect(out).toContain('over-saturate');
    expect(out).toContain('"and so"');
  });

  it('paragraph scope OMITS signature phrases and the anti-overuse directive', () => {
    const out = renderFingerprintProse(TRAITS, 'paragraph');
    expect(out).not.toContain('SPARINGLY');
    expect(out).not.toContain('over-saturate');
    expect(out).not.toContain('"and so"');
  });

  it('is deterministic for the same inputs', () => {
    expect(renderFingerprintProse(TRAITS, 'article')).toEqual(renderFingerprintProse(TRAITS, 'article'));
  });

  // Mirrors updateStyleFingerprintDetailsAction: manually-edited traits validate, then the
  // article prose re-renders from them (no LLM). Guards the manual-edit path.
  it('edited traits validate and re-render the article prose consistently', () => {
    const edited: StyleFingerprintTraits = { ...TRAITS, spellingRegion: 'british', summary: 'A measured British voice.' };
    const parsed = styleFingerprintTraitsSchema.parse(edited);
    const prose = renderFingerprintProse(parsed, 'article');
    expect(prose).toContain('british');
    expect(prose).toContain('A measured British voice.');
  });
});
