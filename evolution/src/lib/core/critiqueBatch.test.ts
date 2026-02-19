// Unit tests for CritiqueBatch utility — shared critique batch execution with error handling.

import { runCritiqueBatch } from './critiqueBatch';
import type { CritiqueBatchOptions } from './critiqueBatch';
import type { Critique, EvolutionLLMClient, EvolutionLogger } from '../types';
import { BudgetExceededError } from '../types';

interface TestItem {
  id: string;
  text: string;
}

function makeMockLLMClient(response: string | string[]): EvolutionLLMClient {
  const responses = Array.isArray(response) ? [...response] : [];
  return {
    complete: Array.isArray(response)
      ? jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? ''))
      : jest.fn().mockResolvedValue(response),
    completeStructured: jest.fn(),
  };
}

function makeMockLogger(): EvolutionLogger {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

function makeItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: `v-${i}`, text: `Text ${i}` }));
}

function makeCritique(id: string): Critique {
  return {
    variationId: id,
    dimensionScores: { clarity: 8 },
    goodExamples: {},
    badExamples: {},
    notes: {},
    reviewer: 'llm',
  };
}

function makeOptions(
  overrides: Partial<CritiqueBatchOptions<TestItem>> = {},
): CritiqueBatchOptions<TestItem> {
  return {
    items: makeItems(3),
    buildPrompt: (item) => `Critique: ${item.text}`,
    agentName: 'test',
    parseResponse: (_raw, item) => makeCritique(item.id),
    ...overrides,
  };
}

describe('runCritiqueBatch', () => {
  it('returns critiques for all items on success (parallel)', async () => {
    const llm = makeMockLLMClient('response');
    const opts = makeOptions();

    const { critiques, entries } = await runCritiqueBatch(llm, opts);

    expect(critiques).toHaveLength(3);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.status === 'success')).toBe(true);
    expect((llm.complete as jest.Mock)).toHaveBeenCalledTimes(3);
  });

  it('returns critiques for all items on success (sequential)', async () => {
    const llm = makeMockLLMClient('response');
    const opts = makeOptions({ parallel: false });

    const { critiques, entries } = await runCritiqueBatch(llm, opts);

    expect(critiques).toHaveLength(3);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.status === 'success')).toBe(true);
  });

  it('returns empty results for empty items', async () => {
    const llm = makeMockLLMClient('response');
    const opts = makeOptions({ items: [] });

    const { critiques, entries } = await runCritiqueBatch(llm, opts);

    expect(critiques).toHaveLength(0);
    expect(entries).toHaveLength(0);
    expect((llm.complete as jest.Mock)).not.toHaveBeenCalled();
  });

  it('marks parse_failed when parseResponse returns null (parallel)', async () => {
    const llm = makeMockLLMClient('bad response');
    const opts = makeOptions({
      parseResponse: () => null,
      logger: makeMockLogger(),
    });

    const { critiques, entries } = await runCritiqueBatch(llm, opts);

    expect(critiques).toHaveLength(0);
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.status === 'parse_failed')).toBe(true);
  });

  it('marks error on LLM failure and continues with others (parallel)', async () => {
    let callCount = 0;
    const llm: EvolutionLLMClient = {
      complete: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error('API error'));
        return Promise.resolve('ok');
      }),
      completeStructured: jest.fn(),
    };
    const logger = makeMockLogger();
    const opts = makeOptions({ logger });

    const { critiques, entries } = await runCritiqueBatch(llm, opts);

    expect(critiques).toHaveLength(2);
    const errorEntry = entries.find((e) => e.status === 'error');
    expect(errorEntry).toBeDefined();
    expect(errorEntry!.error).toContain('API error');
    expect(logger.error).toHaveBeenCalled();
  });

  it('marks error on LLM failure and continues with others (sequential)', async () => {
    let callCount = 0;
    const llm: EvolutionLLMClient = {
      complete: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new Error('Socket timeout'));
        return Promise.resolve('ok');
      }),
      completeStructured: jest.fn(),
    };
    const logger = makeMockLogger();
    const opts = makeOptions({ parallel: false, logger });

    const { critiques, entries } = await runCritiqueBatch(llm, opts);

    expect(critiques).toHaveLength(2);
    const errorEntry = entries.find((e) => e.status === 'error');
    expect(errorEntry).toBeDefined();
    expect(errorEntry!.error).toContain('Socket timeout');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('re-throws BudgetExceededError (parallel)', async () => {
    const llm: EvolutionLLMClient = {
      complete: jest.fn().mockRejectedValue(new BudgetExceededError('test', 1.0, 0.5)),
      completeStructured: jest.fn(),
    };
    const opts = makeOptions();

    await expect(runCritiqueBatch(llm, opts)).rejects.toThrow(BudgetExceededError);
  });

  it('re-throws BudgetExceededError (sequential)', async () => {
    let callCount = 0;
    const llm: EvolutionLLMClient = {
      complete: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 2) return Promise.reject(new BudgetExceededError('test', 1.0, 0.5));
        return Promise.resolve('ok');
      }),
      completeStructured: jest.fn(),
    };
    const opts = makeOptions({ parallel: false });

    await expect(runCritiqueBatch(llm, opts)).rejects.toThrow(BudgetExceededError);
  });

  it('passes correct prompt to LLM', async () => {
    const llm = makeMockLLMClient('response');
    const opts = makeOptions({
      items: [{ id: 'v-0', text: 'My article' }],
      buildPrompt: (item) => `Analyze: ${item.text}`,
    });

    await runCritiqueBatch(llm, opts);

    expect((llm.complete as jest.Mock)).toHaveBeenCalledWith('Analyze: My article', 'test');
  });

  it('passes item to parseResponse', async () => {
    const llm = makeMockLLMClient('raw-response');
    const parseResponse = jest.fn().mockReturnValue(makeCritique('v-0'));
    const items = [{ id: 'v-0', text: 'Text' }];
    const opts = makeOptions({ items, parseResponse });

    await runCritiqueBatch(llm, opts);

    expect(parseResponse).toHaveBeenCalledWith('raw-response', items[0]);
  });

  it('works with single item (parallel mode)', async () => {
    const llm = makeMockLLMClient('response');
    const opts = makeOptions({ items: makeItems(1) });

    const { critiques, entries } = await runCritiqueBatch(llm, opts);

    expect(critiques).toHaveLength(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe('success');
  });
});
