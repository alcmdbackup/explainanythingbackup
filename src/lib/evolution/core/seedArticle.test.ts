// Unit tests for generateSeedArticle shared utility.
// Tests happy path, title parse failure, and LLM error handling.

import { generateSeedArticle } from './seedArticle';
import { createMockEvolutionLLMClient, createMockEvolutionLogger } from '@/testing/utils/evolution-test-helpers';

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
