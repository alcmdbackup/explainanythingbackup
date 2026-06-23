// Tests for extractStyleFingerprint — parse + repair behavior over an injected callFn.

import { extractStyleFingerprint, buildExtractionPrompt, StyleExtractionError } from './extractStyleFingerprint';

const VALID = JSON.stringify({
  sentenceLength: { avgWords: 12, distribution: 'medium' },
  spellingRegion: 'british',
  vocabularyLevel: 'formal',
  tone: ['measured'],
  signaturePhrases: [{ phrase: 'in fact', frequency: 'occasional' }],
  structuralHabits: ['leads with a claim'],
  punctuationHabits: ['frequent semicolons'],
  summary: 'A measured, formal voice.',
});

describe('extractStyleFingerprint', () => {
  it('parses a valid JSON reply', async () => {
    const fp = await extractStyleFingerprint(['some article text'], async () => VALID);
    expect(fp.spellingRegion).toBe('british');
    expect(fp.signaturePhrases[0]?.phrase).toBe('in fact');
  });

  it('strips a ```json fence', async () => {
    const fp = await extractStyleFingerprint(['x'], async () => '```json\n' + VALID + '\n```');
    expect(fp.vocabularyLevel).toBe('formal');
  });

  it('retries once on invalid JSON, then succeeds', async () => {
    let calls = 0;
    const fp = await extractStyleFingerprint(['x'], async () => {
      calls += 1;
      return calls === 1 ? 'not json at all' : VALID;
    });
    expect(calls).toBe(2);
    expect(fp.tone).toEqual(['measured']);
  });

  it('throws StyleExtractionError after a failed repair', async () => {
    await expect(extractStyleFingerprint(['x'], async () => 'garbage')).rejects.toBeInstanceOf(StyleExtractionError);
  });

  it('throws on an empty article set', async () => {
    await expect(extractStyleFingerprint([], async () => VALID)).rejects.toBeInstanceOf(StyleExtractionError);
  });

  it('wraps article bodies in untrusted-data delimiters', () => {
    const prompt = buildExtractionPrompt(['hello world']);
    expect(prompt).toContain('<article index="1">');
    expect(prompt).toContain('untrusted DATA');
  });
});
