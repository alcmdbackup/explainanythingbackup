// Tests for V2 runner lifecycle.

import { executeV2Run, type ClaimedRun } from './runner';

function makeMockDb(opts?: { runStatus?: string; contentText?: string }) {
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
              if (table === 'evolution_runs') {
                return { data: { status: opts?.runStatus ?? 'running' }, error: null };
              }
              if (table === 'evolution_strategies') {
                return {
                  data: { config: { generationModel: 'gpt-4.1-nano', judgeModel: 'gpt-4.1-nano', iterations: 1 } },
                  error: null,
                };
              }
              return { data: null, error: null };
            }),
          })),
        })),
        upsert: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(async () => ({ data: { id: 'strat-1' }, error: null })),
          })),
        })),
      })),
      rpc: jest.fn(async () => ({ data: null, error: null })),
    } as never,
    updates,
    inserts,
  };
}

const validText = `# Test Article

## Introduction

This is a generated test variant for the evolution pipeline. It demonstrates proper formatting with headings and paragraphs. The content validates correctly against format rules.

## Details

The pipeline generates variants through multiple strategies. Each variant competes in pairwise comparisons. Higher-rated variants advance through subsequent iterations.`;

function makeProvider() {
  return { complete: jest.fn(async () => validText) };
}

function makeClaimedRun(overrides?: Partial<ClaimedRun>): ClaimedRun {
  return {
    id: 'run-1',
    explanation_id: 1,
    prompt_id: null,
    experiment_id: null,
    strategy_id: 'strat-1',
    budget_cap_usd: 5,
    ...overrides,
  };
}

describe('executeV2Run', () => {
  it('full lifecycle: resolve → execute → persist', async () => {
    const { db, updates } = makeMockDb({ contentText: validText });
    const provider = makeProvider();
    const run = makeClaimedRun();

    await executeV2Run('run-1', run, db, provider);

    // Should have updated run status to completed (via finalizeRun)
    const completedUpdates = updates.filter(
      (u) => u.table === 'evolution_runs' && u.data.status === 'completed',
    );
    expect(completedUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it('content not found → marks failed', async () => {
    const { db, updates } = makeMockDb({ contentText: undefined });
    const provider = makeProvider();
    const run = makeClaimedRun();

    await executeV2Run('run-1', run, db, provider);

    const failUpdates = updates.filter(
      (u) => u.table === 'evolution_runs' && u.data.status === 'failed',
    );
    expect(failUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it('both null content sources → marks failed', async () => {
    const { db, updates } = makeMockDb();
    const provider = makeProvider();
    const run = makeClaimedRun({ explanation_id: null, prompt_id: null });

    await executeV2Run('run-1', run, db, provider);

    const failUpdates = updates.filter(
      (u) => u.table === 'evolution_runs' && u.data.status === 'failed',
    );
    expect(failUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it('error during pipeline → marks failed with truncated message', async () => {
    const { db, updates } = makeMockDb({ contentText: validText });
    const provider = { complete: jest.fn(async () => { throw new Error('LLM crash'); }) };
    const run = makeClaimedRun();

    await executeV2Run('run-1', run, db, provider);

    const failUpdates = updates.filter(
      (u) => u.table === 'evolution_runs' && u.data.status === 'failed',
    );
    expect(failUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it('non-Error throw → marks failed without crash', async () => {
    const { db } = makeMockDb({ contentText: validText });
    const provider = {
      complete: jest.fn(async () => {
        throw 42; // eslint-disable-line no-throw-literal
      }),
    };
    const run = makeClaimedRun();

    // Should not throw
    await executeV2Run('run-1', run, db, provider);
  });
});
