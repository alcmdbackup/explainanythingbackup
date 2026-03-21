// Tests for buildRunContext: strategy resolution, content resolution, arena loading.

import { buildRunContext, type ClaimedRun } from './buildRunContext';

const validText = `# Test Article

## Introduction

This is a generated test variant for the evolution pipeline. It demonstrates proper formatting with headings and paragraphs. The content validates correctly against format rules.

## Details

The pipeline generates variants through multiple strategies. Each variant competes in pairwise comparisons. Higher-rated variants advance through subsequent iterations.`;

function makeClaimedRun(overrides?: Partial<ClaimedRun>): ClaimedRun {
  return {
    id: 'run-1',
    explanation_id: 1,
    prompt_id: null,
    experiment_id: null,
    strategy_config_id: 'strat-1',
    budget_cap_usd: 5,
    ...overrides,
  };
}

function makeMockDb(opts?: { contentText?: string; strategyConfig?: Record<string, unknown> | null; strategyError?: boolean }) {
  const updates: Array<{ table: string; data: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; data: Record<string, unknown> }> = [];

  return {
    db: {
      from: jest.fn((table: string) => ({
        update: jest.fn((data: Record<string, unknown>) => {
          updates.push({ table, data });
          return {
            eq: jest.fn(() => ({
              in: jest.fn(async () => ({ error: null })),
            })),
          };
        }),
        insert: jest.fn((data: Record<string, unknown>) => {
          inserts.push({ table, data });
          return {
            select: jest.fn(() => ({
              single: jest.fn(async () => ({
                data: { id: `inv-${Math.random().toString(36).slice(2, 6)}` },
                error: null,
              })),
            })),
          };
        }),
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn(async () => {
              if (table === 'explanations') {
                return {
                  data: opts?.contentText ? { content: opts.contentText } : null,
                  error: opts?.contentText ? null : { message: 'not found' },
                };
              }
              if (table === 'evolution_strategy_configs') {
                if (opts?.strategyError) {
                  return { data: null, error: { message: 'db error' } };
                }
                const config = opts?.strategyConfig ?? {
                  generationModel: 'gpt-4.1-nano',
                  judgeModel: 'gpt-4.1-nano',
                  iterations: 1,
                };
                return { data: { config }, error: null };
              }
              if (table === 'evolution_arena_topics') {
                return { data: { prompt: 'test prompt' }, error: null };
              }
              return { data: null, error: null };
            }),
          })),
        })),
      })),
    } as never,
    updates,
    inserts,
  };
}

function makeProvider() {
  return { complete: jest.fn(async () => validText) };
}

describe('buildRunContext', () => {
  it('resolves context for explanation-based run', async () => {
    const { db } = makeMockDb({ contentText: validText });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.originalText).toBe(validText);
      expect(result.context.config.iterations).toBe(1);
      expect(result.context.initialPool).toEqual([]);
    }
  });

  it('returns error when strategy config not found', async () => {
    const { db } = makeMockDb({ contentText: validText, strategyError: true });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Strategy');
    }
  });

  it('returns error when strategy config is invalid', async () => {
    const { db } = makeMockDb({ contentText: validText, strategyConfig: { generationModel: null } });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('invalid config');
    }
  });

  it('returns error when content not found', async () => {
    const { db } = makeMockDb({ contentText: undefined });
    const run = makeClaimedRun();

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('Explanation');
    }
  });

  it('returns error when both explanation_id and prompt_id are null', async () => {
    const { db } = makeMockDb();
    const run = makeClaimedRun({ explanation_id: null, prompt_id: null });

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('No content source');
    }
  });

  it('applies budget_cap_usd from claimed run', async () => {
    const { db } = makeMockDb({ contentText: validText });
    const run = makeClaimedRun({ budget_cap_usd: 7.5 });

    const result = await buildRunContext('run-1', run, db, makeProvider());

    expect('context' in result).toBe(true);
    if ('context' in result) {
      expect(result.context.config.budgetUsd).toBe(7.5);
    }
  });
});
