// Tests for V2 seed article generation.

import { generateSeedArticle } from './generateSeedArticle';

function makeMockLlm(responses?: string[]) {
  let callIdx = 0;
  const defaultResponses = ['Test Title', '## Introduction\n\nTest content with multiple sentences. It is well formatted.'];
  return {
    complete: jest.fn(async () => {
      const resp = (responses ?? defaultResponses)[callIdx] ?? '';
      callIdx++;
      return resp;
    }),
  };
}

describe('generateSeedArticle', () => {
  it('generates title + content from prompt via 2 LLM calls', async () => {
    const llm = makeMockLlm();
    const result = await generateSeedArticle('quantum computing', llm);
    expect(result.title).toBe('Test Title');
    expect(result.content).toContain('# Test Title');
    expect(result.content).toContain('Test content');
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('title LLM error propagates', async () => {
    const llm = { complete: jest.fn(async () => { throw new Error('API down'); }) };
    await expect(generateSeedArticle('topic', llm)).rejects.toThrow('API down');
  });

  it('article LLM error propagates', async () => {
    let call = 0;
    const llm = {
      complete: jest.fn(async () => {
        call++;
        if (call === 1) return 'Title';
        throw new Error('Article gen failed');
      }),
    };
    await expect(generateSeedArticle('topic', llm)).rejects.toThrow('Article gen failed');
  });

  it('empty prompt returns sensible default title', async () => {
    const llm = makeMockLlm(['', '## Content\n\nSome content here. Multiple sentences.']);
    const result = await generateSeedArticle('fallback topic', llm);
    // Empty title falls back to prompt slice
    expect(result.title.length).toBeGreaterThan(0);
  });

  it('title includes # prefix in content', async () => {
    const llm = makeMockLlm();
    const result = await generateSeedArticle('topic', llm);
    expect(result.content.startsWith('# ')).toBe(true);
  });

  it('JSON title parse falls back to plain text', async () => {
    // When JSON parse returns a plain string (not object with title1), falls through to plain text cleanup
    const llm = makeMockLlm(['  "My Great Title"  ', '## Section\n\nContent here. More text.']);
    const result = await generateSeedArticle('topic', llm);
    // Plain text fallback strips quotes and trims
    expect(result.title).toBe('My Great Title');
  });

  it('calls logger.debug for title and article generation', async () => {
    const { createMockEntityLogger } = await import('../../../testing/evolution-test-helpers');
    const { logger } = createMockEntityLogger();
    const llm = makeMockLlm();
    await generateSeedArticle('quantum computing', llm, logger);
    expect(logger.debug).toHaveBeenCalledWith('Starting seed title generation', expect.objectContaining({ phaseName: 'seed_setup' }));
    expect(logger.debug).toHaveBeenCalledWith('Seed title generated', expect.objectContaining({ phaseName: 'seed_setup' }));
    expect(logger.debug).toHaveBeenCalledWith('Starting seed article generation', expect.objectContaining({ phaseName: 'seed_setup' }));
  });

  it('calls logger.info with seed article complete message', async () => {
    const { createMockEntityLogger } = await import('../../../testing/evolution-test-helpers');
    const { logger } = createMockEntityLogger();
    const llm = makeMockLlm();
    await generateSeedArticle('quantum computing', llm, logger);
    expect(logger.info).toHaveBeenCalledWith('Seed article complete', expect.objectContaining({ phaseName: 'seed_setup' }));
  });

  it('no errors when logger is undefined (existing behavior preserved)', async () => {
    const llm = makeMockLlm();
    const result = await generateSeedArticle('quantum computing', llm);
    expect(result.title).toBe('Test Title');
    expect(result.content).toContain('Test content');
  });
});
