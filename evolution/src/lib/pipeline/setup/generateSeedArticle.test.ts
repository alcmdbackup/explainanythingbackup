// Tests for V2 seed article generation.

import { generateSeedArticle } from './generateSeedArticle';

function makeMockLlm(responses?: string[]) {
  let callIdx = 0;
  const defaultResponses = ['Test Title', '## Introduction\n\nTest content with multiple sentences. It is well formatted.'];
  const responsesToUse = responses ?? defaultResponses;
  return {
    complete: jest.fn<Promise<string>, [prompt: string, label: string]>(async () => {
      if (callIdx >= responsesToUse.length) {
        throw new Error(`Unexpected LLM call #${callIdx + 1} (only ${responsesToUse.length} responses provided)`);
      }
      return responsesToUse[callIdx++]!;
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
    const llm = { complete: jest.fn<Promise<string>, [prompt: string, label: string]>(async () => { throw new Error('API down'); }) };
    await expect(generateSeedArticle('topic', llm)).rejects.toThrow('API down');
  });

  it('article LLM error propagates', async () => {
    let call = 0;
    const llm = {
      complete: jest.fn<Promise<string>, [prompt: string, label: string]>(async () => {
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

  describe('E2E_TEST_MODE seed mock', () => {
    const origEnv = process.env.E2E_TEST_MODE;
    const origNodeEnv = process.env.NODE_ENV;
    const origCI = process.env.CI;

    afterEach(() => {
      process.env.E2E_TEST_MODE = origEnv;
      process.env.NODE_ENV = origNodeEnv;
      process.env.CI = origCI;
    });

    it('returns a deterministic [TEST_EVO] article and makes ZERO LLM calls when E2E_TEST_MODE=true', async () => {
      process.env.E2E_TEST_MODE = 'true';
      // llm throws if called — proves the mock short-circuits before any LLM call.
      const llm = { complete: jest.fn<Promise<string>, [prompt: string, label: string]>(async () => { throw new Error('LLM must not be called in E2E mode'); }) };
      const result = await generateSeedArticle('quantum computing', llm);
      expect(llm.complete).not.toHaveBeenCalled();
      expect(result.title).toContain('[TEST_EVO]');
      expect(result.title).toContain('quantum computing');
      expect(result.content).toContain('# [TEST_EVO]');
    });

    it('THROWS in a real production runtime (NODE_ENV=production, not CI) so the mock can never run in prod', async () => {
      process.env.E2E_TEST_MODE = 'true';
      process.env.NODE_ENV = 'production';
      delete process.env.CI;
      const llm = makeMockLlm();
      await expect(generateSeedArticle('topic', llm)).rejects.toThrow(/cannot be enabled in production/);
    });

    it('still mocks (does not throw) under production+CI (trusted CI runner)', async () => {
      process.env.E2E_TEST_MODE = 'true';
      process.env.NODE_ENV = 'production';
      process.env.CI = 'true';
      const llm = { complete: jest.fn<Promise<string>, [prompt: string, label: string]>(async () => { throw new Error('LLM must not be called'); }) };
      const result = await generateSeedArticle('topic', llm);
      expect(result.title).toContain('[TEST_EVO]');
      expect(llm.complete).not.toHaveBeenCalled();
    });
  });
});
