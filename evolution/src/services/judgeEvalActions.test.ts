// Tests for Judge Lab server actions: model allow-list rejection (before any DB/LLM),
// test-set-not-found, and the leaderboard query (test-set scoped, kind filter). The cap +
// kill-switch logic itself is unit-tested in evolution/src/lib/judgeEval/settings.test.ts.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { createTableAwareMock } from '@evolution/testing/service-test-mocks';

jest.mock('@/lib/utils/supabase/server', () => ({ createSupabaseServiceClient: jest.fn() }));
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));
jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));
jest.mock('@/lib/serverReadRequestId', () => ({ serverReadRequestId: jest.fn((fn: unknown) => fn) }));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/services/auditLog', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));

import {
  createEvalRunAction,
  getEvalLeaderboardAction,
  cloneTestSetAction,
  getEvalRunDetailAction,
  getJudgeEvalCallsAction,
  getJudgeEvalCallDetailAction,
} from './judgeEvalActions';

const mockCreate = createSupabaseServiceClient as jest.MockedFunction<typeof createSupabaseServiceClient>;
const TEST_SET = '550e8400-e29b-41d4-a716-446655440000';

describe('cloneTestSetAction', () => {
  it('rejects a manual clone with empty manualLabels before any DB call (zod refine)', async () => {
    const mock = createTableAwareMock([]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await cloneTestSetAction({ sourceTestSetId: TEST_SET, newName: 'x', strategy: 'manual' });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error?.message).toMatch(/manualLabels/);
    expect(mock.from).not.toHaveBeenCalled();
  });
});

describe('createEvalRunAction', () => {
  it('rejects a model not in the evolution allow-list before any DB call', async () => {
    const mock = createTableAwareMock([]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await createEvalRunAction({
      testSetName: 'fr2-smoke',
      models: ['definitely-not-a-real-model'],
      temperatures: [0],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error?.message).toMatch(/Invalid judgeModel/);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('errors when the test set does not exist', async () => {
    const mock = createTableAwareMock([
      // loadTestSetByName → judge_eval_test_sets .maybeSingle() → null
      (b) => {
        b.maybeSingle!.mockResolvedValueOnce({ data: null, error: null });
      },
    ]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await createEvalRunAction({
      testSetName: 'missing',
      models: ['qwen-2.5-7b-instruct'],
      temperatures: [0],
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error?.message).toMatch(/Test set not found/);
  });
});

describe('getEvalLeaderboardAction', () => {
  it('enriches rows with the custom prompt used (from judge_eval_runs.prompt_variant)', async () => {
    const rows = [{ eval_run_id: 'r1', judge_model: 'qwen-2.5-7b-instruct', pair_kind: 'article', decisive_rate: 1 }];
    const runRows = [{ id: 'r1', prompt_variant: 'CUSTOM RUBRIC TEXT' }];
    const mock = createTableAwareMock([
      // 1st .from(): the leaderboard view (terminal await on the chain)
      (b) => {
        b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: rows, error: null }));
      },
      // 2nd .from(): judge_eval_runs prompt-variant enrichment (.in('id', runIds))
      (b) => {
        b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: runRows, error: null }));
      },
    ]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await getEvalLeaderboardAction({ testSetId: TEST_SET, kind: 'article' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual([
        { ...rows[0], prompt_variant: 'CUSTOM RUBRIC TEXT', used_custom_prompt: true },
      ]);
    }
    expect(mock.from).toHaveBeenCalledWith('judge_eval_settings_leaderboard');
    expect(mock.from).toHaveBeenCalledWith('judge_eval_runs');
  });

  it('marks rows with no custom prompt as built-in (used_custom_prompt=false)', async () => {
    const rows = [{ eval_run_id: 'r2', judge_model: 'gpt-4.1-nano', pair_kind: 'paragraph', decisive_rate: 0.5 }];
    const runRows = [{ id: 'r2', prompt_variant: null }];
    const mock = createTableAwareMock([
      (b) => {
        b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: rows, error: null }));
      },
      (b) => {
        b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: runRows, error: null }));
      },
    ]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await getEvalLeaderboardAction({ testSetId: TEST_SET, kind: 'paragraph' });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual([{ ...rows[0], prompt_variant: null, used_custom_prompt: false }]);
    }
  });
});

const CALL = '660e8400-e29b-41d4-a716-446655440111';

describe('getEvalRunDetailAction', () => {
  it('selects explicit Core columns for calls — never SELECT * or the heavy audit payload', async () => {
    let callsSelect: jest.Mock | undefined;
    const mock = createTableAwareMock([
      // 1st .from(): judge_eval_runs (.single) — default thenable resolves {data:null,error:null}.
      () => {},
      // 2nd .from(): judge_eval_calls — capture the select arg + resolve an empty list.
      (b) => {
        callsSelect = b.select;
        b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: [], error: null }));
      },
    ]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await getEvalRunDetailAction({ runId: TEST_SET, kind: 'both' });
    expect(res.success).toBe(true);
    const sel = callsSelect!.mock.calls[0]![0] as string;
    expect(sel).not.toBe('*');
    expect(sel).toContain('confidence'); // a Core metric column
    expect(sel).toContain('gap_kind'); // a snapshot column
    expect(sel).not.toContain('forward_prompt'); // heavy audit must NOT leak into the list read
    expect(sel).not.toContain('forward_raw');
  });
});

describe('getJudgeEvalCallsAction', () => {
  it('returns paginated Core rows + total and selects explicit columns (no SELECT *, no audit)', async () => {
    const rows = [{ id: CALL, pair_label: 'art#1', pair_kind: 'article', winner: 'A', confidence: 1, decisive: true, gap_kind: 'large', baseline_confidence: 1 }];
    let callsSelect: jest.Mock | undefined;
    const mock = createTableAwareMock([
      (b) => {
        callsSelect = b.select;
        b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: rows, error: null, count: 7 }));
      },
    ]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await getJudgeEvalCallsAction({ runId: TEST_SET, limit: 1, offset: 0 });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.total).toBe(7);
      expect(res.data.limit).toBe(1);
      expect(res.data.calls).toEqual(rows);
    }
    expect(mock.from).toHaveBeenCalledWith('judge_eval_calls');
    const sel = callsSelect!.mock.calls[0]![0] as string;
    expect(sel).not.toBe('*');
    expect(sel).toContain('forward_winner');
    expect(sel).not.toContain('forward_prompt');
    expect(sel).not.toContain('forward_raw');
  });
});

describe('getJudgeEvalCallDetailAction', () => {
  it('returns the audit payload and selects only audit columns', async () => {
    const audit = {
      id: CALL, forward_prompt: '## Text A\nx', reverse_prompt: '## Text A\ny',
      forward_reasoning: 'r1', reverse_reasoning: 'r2', forward_raw: 'A', reverse_raw: 'B',
      reasoning_trace_format: 'verbatim',
    };
    let sel: jest.Mock | undefined;
    const mock = createTableAwareMock([
      (b) => {
        sel = b.select;
        b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: audit, error: null }));
      },
    ]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await getJudgeEvalCallDetailAction({ callId: CALL });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data).toEqual(audit);
    expect((sel!.mock.calls[0]![0] as string)).toContain('forward_prompt');
  });

  it('tolerates a legacy row with all-null audit fields (no throw)', async () => {
    const audit = {
      id: CALL, forward_prompt: null, reverse_prompt: null, forward_reasoning: null,
      reverse_reasoning: null, forward_raw: null, reverse_raw: null, reasoning_trace_format: null,
    };
    const mock = createTableAwareMock([
      (b) => {
        b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: audit, error: null }));
      },
    ]);
    mockCreate.mockResolvedValue(mock as never);
    const res = await getJudgeEvalCallDetailAction({ callId: CALL });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data!.forward_prompt).toBeNull();
  });
});
