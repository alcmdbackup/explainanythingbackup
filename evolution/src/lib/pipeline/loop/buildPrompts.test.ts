// Tests for the shared evolution prompt builder.

import { buildEvolutionPrompt } from './buildPrompts';
import { FORMAT_RULES } from '../../shared/enforceVariantFormat';

describe('buildEvolutionPrompt', () => {
  const preamble = 'You are an expert writer.';
  const textLabel = 'Source Article';
  const text = 'The quick brown fox jumps over the lazy dog.';
  const instructions = 'Improve clarity and readability.';
  const feedback = {
    weakestDimension: 'coherence',
    suggestions: ['Add transitions', 'Strengthen thesis'],
  };

  it('builds complete prompt with all sections in order', () => {
    const result = buildEvolutionPrompt(preamble, textLabel, text, instructions, feedback);

    const preambleIdx = result.indexOf(preamble);
    const textLabelIdx = result.indexOf(`## ${textLabel}`);
    const textIdx = result.indexOf(text);
    const feedbackIdx = result.indexOf('## Feedback');
    const taskIdx = result.indexOf('## Task');
    const formatIdx = result.indexOf(FORMAT_RULES);
    const outputIdx = result.indexOf('Output ONLY the improved text');

    expect(preambleIdx).toBeLessThan(textLabelIdx);
    expect(textLabelIdx).toBeLessThan(textIdx);
    expect(textIdx).toBeLessThan(feedbackIdx);
    expect(feedbackIdx).toBeLessThan(taskIdx);
    expect(taskIdx).toBeLessThan(formatIdx);
    expect(formatIdx).toBeLessThan(outputIdx);
  });

  it('includes feedback section when provided', () => {
    const result = buildEvolutionPrompt(preamble, textLabel, text, instructions, feedback);

    expect(result).toContain('## Feedback');
    expect(result).toContain('Weakest dimension: coherence');
    expect(result).toContain('- Add transitions');
    expect(result).toContain('- Strengthen thesis');
  });

  it('omits feedback section when not provided', () => {
    const result = buildEvolutionPrompt(preamble, textLabel, text, instructions);

    expect(result).not.toContain('## Feedback');
    expect(result).not.toContain('Weakest dimension');
    expect(result).not.toContain('Suggestions');
  });

  it('always includes FORMAT_RULES regardless of feedback', () => {
    const withFeedback = buildEvolutionPrompt(preamble, textLabel, text, instructions, feedback);
    const withoutFeedback = buildEvolutionPrompt(preamble, textLabel, text, instructions);

    expect(withFeedback).toContain(FORMAT_RULES);
    expect(withoutFeedback).toContain(FORMAT_RULES);
  });

  it('preserves multiline text sections correctly', () => {
    const multilineText = 'Line one.\n\nLine two.\n\nLine three with special chars: <>&"';
    const result = buildEvolutionPrompt(preamble, textLabel, multilineText, instructions);

    expect(result).toContain(multilineText);
    expect(result).toContain('Line one.\n\nLine two.\n\nLine three');
  });

  it('handles empty inputs without breaking structure', () => {
    const result = buildEvolutionPrompt('', '', '', '');

    expect(result).toContain('## ');
    expect(result).toContain('## Task');
    expect(result).toContain(FORMAT_RULES);
    expect(result).toContain('Output ONLY the improved text, no explanations.');
  });
});
