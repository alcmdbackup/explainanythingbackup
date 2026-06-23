// Renders structured StyleFingerprintTraits into a deterministic prose block that is
// injected into generation prompts and the judging rubric.
//
// Two scopes (generate_enforce_style_fingerprint_evolution_20260620 + 2026-06-21 decision):
//   'article'   — full piece: INCLUDES the cross-piece anti-overuse directive for signature
//                 phrases (use sparingly across the whole piece; never force/over-saturate).
//   'paragraph' — single paragraph: keeps sentence-length / spelling / tone / punctuation,
//                 but OMITS signature-phrase guidance so a paragraph isn't penalized for
//                 lacking phrases it naturally wouldn't contain.

import type { StyleFingerprintTraits } from '../../schemas';

export type FingerprintProseScope = 'article' | 'paragraph';

export function renderFingerprintProse(
  traits: StyleFingerprintTraits,
  scope: FingerprintProseScope,
): string {
  const lines: string[] = [];
  lines.push(`Match this author's voice: ${traits.summary}`);
  lines.push(
    `Sentences average ~${Math.round(traits.sentenceLength.avgWords)} words (${traits.sentenceLength.distribution}).`,
  );
  lines.push(`Use ${traits.spellingRegion} spelling and usage conventions.`);
  if (traits.tone.length > 0) lines.push(`Tone: ${traits.tone.join(', ')}.`);
  lines.push(`Vocabulary: ${traits.vocabularyLevel}.`);
  if (traits.punctuationHabits.length > 0) {
    lines.push(`Punctuation habits: ${traits.punctuationHabits.join('; ')}.`);
  }
  if (traits.structuralHabits.length > 0) {
    lines.push(`Structural habits: ${traits.structuralHabits.join('; ')}.`);
  }

  // Signature phrases: article scope only (with the anti-overuse directive). The paragraph
  // scope intentionally omits this so single-paragraph judging/generation does not penalize
  // the natural absence of the author's signature phrases.
  if (scope === 'article' && traits.signaturePhrases.length > 0) {
    const phrases = traits.signaturePhrases.map((p) => `"${p.phrase}"`).join(', ');
    lines.push(
      `The author occasionally uses signature phrases such as ${phrases}. ` +
        `Use them SPARINGLY and only where natural across the whole piece — never force them or over-saturate.`,
    );
  }

  return lines.join('\n');
}
