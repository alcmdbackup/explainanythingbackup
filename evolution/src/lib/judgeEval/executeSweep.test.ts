// Unit tests for the sweep orchestrator's failure-persistence path: when the engine throws
// mid-cell, executeSweep must persist whatever completed (carried on the error's partialResults)
// via replaceCalls so the run becomes a real errored run rather than a 0-call orphan, then
// re-throw. The persist/engine/cost/settings deps are mocked so this is pure orchestration.

import { executeSweep, type SweepGrid } from './executeSweep';
import { loadTestSetPairs, upsertRun, replaceCalls } from './persist';
import { runJudgeEval } from './runJudgeEval';
import { estimateSweepCost } from './cost';
import { assertWithinJudgeEvalCap } from './settings';
import type { JudgeEvalCallResult } from './schemas';

jest.mock('./persist', () => ({
  loadTestSetPairs: jest.fn(),
  upsertRun: jest.fn(),
  replaceCalls: jest.fn(),
}));
jest.mock('./runJudgeEval', () => ({
  runJudgeEval: jest.fn(),
  createCallLLMJudge: jest.fn(() => async () => ({
    text: 'Your answer: A',
    costUsd: 0,
    promptTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  })),
}));
jest.mock('./cost', () => ({ estimateSweepCost: jest.fn() }));
jest.mock('./settings', () => ({ assertWithinJudgeEvalCap: jest.fn() }));

const mockLoadPairs = loadTestSetPairs as jest.MockedFunction<typeof loadTestSetPairs>;
const mockUpsertRun = upsertRun as jest.MockedFunction<typeof upsertRun>;
const mockReplaceCalls = replaceCalls as jest.MockedFunction<typeof replaceCalls>;
const mockRunJudgeEval = runJudgeEval as jest.MockedFunction<typeof runJudgeEval>;
const mockEstimate = estimateSweepCost as jest.MockedFunction<typeof estimateSweepCost>;
const mockCap = assertWithinJudgeEvalCap as jest.MockedFunction<typeof assertWithinJudgeEvalCap>;

const db = {} as never;

function grid(overrides: Partial<SweepGrid> = {}): SweepGrid {
  return {
    testSetId: 'ts1',
    kindFilter: 'both',
    models: ['deepseek-v4-flash'],
    temperatures: [0],
    reasoningEfforts: [null],
    promptVariant: null,
    explainReasoning: false,
    repeats: 1,
    ...overrides,
  };
}

function row(overrides: Partial<JudgeEvalCallResult> = {}): JudgeEvalCallResult {
  return {
    pair_label: 'art#0001',
    pair_kind: 'article',
    comparison_mode: 'article',
    repeat_index: 0,
    forward_winner: null,
    reverse_winner: null,
    winner: 'TIE',
    confidence: 0,
    wall_ms: null,
    fwd_ms: null,
    rev_ms: null,
    prompt_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    cost_usd: null,
    forward_raw: null,
    reverse_raw: null,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadPairs.mockResolvedValue({
    testSet: { id: 'ts1', name: 'fr2-smoke' },
    pairs: [
      {
        label: 'art#0001',
        pair_kind: 'article',
        variant_a_id: '00000000-0000-4000-8000-000000000001',
        variant_b_id: '00000000-0000-4000-8000-000000000002',
        text_a: 'A',
        text_b: 'B',
        mu_a: 40,
        mu_b: 20,
        sigma_a: 5,
        sigma_b: 5,
        expected_winner: 'A',
        gap_kind: 'large',
        baseline_confidence: 1,
      },
    ],
  } as never);
  mockEstimate.mockReturnValue({ cells: 1, comparisons: 2, estimatedCostUsd: 0.01 } as never);
  mockCap.mockReturnValue({ plannedCalls: 2 } as never);
  mockUpsertRun.mockResolvedValue({ runId: 'run1', settingsKey: 'key1' } as never);
});

it('persists partial results (errored repeat) instead of a 0-call orphan when the engine throws', async () => {
  const errored = row({ error: 'gateway timeout 504' });
  mockRunJudgeEval.mockRejectedValue(
    Object.assign(new Error('gateway timeout 504'), { partialResults: [errored] }),
  );

  await expect(executeSweep(db, grid())).rejects.toThrow(/504/);

  // The run was persisted with the errored row — NOT left as a 0-call orphan.
  expect(mockReplaceCalls).toHaveBeenCalledTimes(1);
  expect(mockReplaceCalls).toHaveBeenCalledWith(db, 'run1', [errored]);
});

it('does not call replaceCalls when the engine throws with no partial results', async () => {
  mockRunJudgeEval.mockRejectedValue(new Error('boom with no partials'));

  await expect(executeSweep(db, grid())).rejects.toThrow(/boom with no partials/);
  expect(mockReplaceCalls).not.toHaveBeenCalled();
});

it('persists all results on the success path', async () => {
  const ok = row({ winner: 'A', confidence: 1, error: null });
  mockRunJudgeEval.mockResolvedValue([ok]);

  const out = await executeSweep(db, grid());

  expect(mockReplaceCalls).toHaveBeenCalledWith(db, 'run1', [ok]);
  expect(out.cells).toHaveLength(1);
  expect(out.cells[0]!.calls).toBe(2); // 1 result × 2 passes
});

it('dry run returns the estimate without running the engine', async () => {
  const out = await executeSweep(db, grid(), { dryRun: true });
  expect(out.dryRun).toBe(true);
  expect(mockRunJudgeEval).not.toHaveBeenCalled();
  expect(mockReplaceCalls).not.toHaveBeenCalled();
});
