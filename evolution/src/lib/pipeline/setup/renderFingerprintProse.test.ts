// Tests for renderFingerprintProse — deterministic prose from traits, with scope-specific
// signature-phrase handling (article includes the anti-overuse directive; paragraph omits it).

import { renderFingerprintProse } from './renderFingerprintProse';
import type { StyleFingerprintTraits } from '../../schemas';

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
});
