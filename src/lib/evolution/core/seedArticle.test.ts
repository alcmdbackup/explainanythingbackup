// Unit tests for generateTitle helper and generateSeedArticle shared utility.
// Tests JSON parsing, plain-text fallback, length capping, and LLM error handling.

import { generateTitle, generateSeedArticle } from './seedArticle';
import { createMockEvolutionLLMClient, createMockEvolutionLogger } from '@/testing/utils/evolution-test-helpers';

describe('generateTitle', () => {
  it('parses valid JSON response and returns title1', async () => {
    const json = JSON.stringify({ title1: 'My Title', title2: 'Alt', title3: 'Alt2' });
    const result = await generateTitle('some prompt', async () => json);
    expect(result).toBe('My Title');
  });

  it('falls back to plain text when JSON parsing fails', async () => {
    const result = await generateTitle('some prompt', async () => 'A Plain Title');
    expect(result).toBe('A Plain Title');
  });

  it('strips quotes and newlines from plain-text fallback', async () => {
    const result = await generateTitle('some prompt', async () => '"Title\nWith\nNewlines"');
    expect(result).toBe('TitleWithNewlines');
  });

  it('caps plain-text fallback to 200 characters', async () => {
    const longText = 'A'.repeat(300);
    const result = await generateTitle('some prompt', async () => longText);
    expect(result).toHaveLength(200);
  });

  it('passes the title prompt to callFn', async () => {
    const callFn = jest.fn().mockResolvedValue(JSON.stringify({ title1: 'T', title2: 'T', title3: 'T' }));
    await generateTitle('my topic', callFn);
    expect(callFn).toHaveBeenCalledTimes(1);
    // The prompt passed to callFn should contain the topic (via createTitlePrompt)
    expect(callFn.mock.calls[0][0]).toContain('my topic');
  });

  it('propagates callFn errors', async () => {
    await expect(
      generateTitle('topic', async () => { throw new Error('LLM down'); }),
    ).rejects.toThrow('LLM down');
  });
});

describe('generateSeedArticle', () => {
  it('returns title and content from valid LLM responses', async () => {
    const titleJson = JSON.stringify({
      title1: 'Quantum Entanglement',
      title2: 'Quantum Entanglement',
      title3: 'Quantum Entanglement',
    });
    const mockClient = createMockEvolutionLLMClient({
      complete: jest.fn()
        .mockResolvedValueOnce(titleJson) // title call
        .mockResolvedValueOnce('Quantum entanglement is a phenomenon...'), // article call
    });
    const mockLogger = createMockEvolutionLogger();

    const result = await generateSeedArticle('Explain quantum entanglement', mockClient, mockLogger);

    expect(result.title).toBe('Quantum Entanglement');
    expect(result.content).toContain('# Quantum Entanglement');
    expect(result.content).toContain('Quantum entanglement is a phenomenon');
    expect(mockClient.complete).toHaveBeenCalledTimes(2);
  });

  it('falls back to raw title when JSON parse fails', async () => {
    const mockClient = createMockEvolutionLLMClient({
      complete: jest.fn()
        .mockResolvedValueOnce('Understanding Black Holes') // non-JSON title
        .mockResolvedValueOnce('Black holes are regions of spacetime...'),
    });
    const mockLogger = createMockEvolutionLogger();

    const result = await generateSeedArticle('Explain black holes', mockClient, mockLogger);

    expect(result.title).toBe('Understanding Black Holes');
    expect(result.content).toContain('# Understanding Black Holes');
  });

  it('throws descriptive error when title LLM call fails', async () => {
    const mockClient = createMockEvolutionLLMClient({
      complete: jest.fn().mockRejectedValue(new Error('API timeout')),
    });
    const mockLogger = createMockEvolutionLogger();

    await expect(
      generateSeedArticle('Explain gravity', mockClient, mockLogger),
    ).rejects.toThrow(/Seed title generation failed.*API timeout/);
  });

  it('throws descriptive error when article LLM call fails', async () => {
    const mockClient = createMockEvolutionLLMClient({
      complete: jest.fn()
        .mockResolvedValueOnce(JSON.stringify({ title1: 'Gravity', title2: 'Gravity', title3: 'Gravity' })) // title succeeds
        .mockRejectedValueOnce(new Error('Rate limited')), // article fails
    });
    const mockLogger = createMockEvolutionLogger();

    await expect(
      generateSeedArticle('Explain gravity', mockClient, mockLogger),
    ).rejects.toThrow('Seed article generation failed');
  });
});
