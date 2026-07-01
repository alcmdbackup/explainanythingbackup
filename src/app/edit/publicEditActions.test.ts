/**
 * @jest-environment node
 */
// Unit tests for submitPublicEditAction + getEditRunStatusAction
// (Phase 1 of build_website_for_evolutiOn_20260626).

jest.mock('@/lib/server_utilities', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));
jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));
jest.mock('next/headers', () => ({
  headers: jest.fn(),
}));
jest.mock('botid/server', () => ({
  checkBotId: jest.fn().mockResolvedValue({ isBot: false, isHuman: true, isVerifiedBot: false, bypassed: false }),
}));
jest.mock('@/lib/services/perIpSpendingGate', () => ({
  getPerIpSpendingGate: jest.fn(),
  getClientGeo: jest.fn(),
  PerIpBudgetExceededError: class extends Error {
    scope = 'ip' as const;
    key = '';
    current = 0;
    cap = 0;
  },
}));

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { headers as nextHeaders } from 'next/headers';
import { checkBotId } from 'botid/server';
import { getPerIpSpendingGate, getClientGeo } from '@/lib/services/perIpSpendingGate';
import { submitPublicEditAction } from './publicEditActions';

const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv };
  jest.clearAllMocks();
  (process.env as Record<string, string | undefined>).PUBLIC_EDIT_DISABLED = undefined;
  (process.env as Record<string, string | undefined>).BOT_PROTECTION_DISABLED = 'true';
  (getClientGeo as jest.Mock).mockReturnValue({ ip: '1.2.3.4', country: 'US' });
  (nextHeaders as jest.Mock).mockResolvedValue(new Headers());
  (getPerIpSpendingGate as jest.Mock).mockReturnValue({
    remainingForIp: jest.fn().mockResolvedValue({ ipRemaining: 0.5, regionRemaining: 5 }),
    reserveForIp: jest.fn().mockResolvedValue(0.1),
    releaseForIp: jest.fn(),
    recordActualForIp: jest.fn(),
  });
});
afterAll(() => { process.env = originalEnv; });

function mockSupabaseChain(opts: {
  strategyRow?: unknown;
  topicRow?: unknown;
  explanationRow?: unknown;
  runRow?: unknown;
}) {
  // Each .from(table) returns a chainable mock; .maybeSingle/.single resolves
  // to the appropriate row keyed on the table name.
  const fromCall = jest.fn();
  const supabase = { from: fromCall };

  fromCall.mockImplementation((table: string) => {
    const chain: Record<string, jest.Mock> = {};
    chain.select = jest.fn().mockReturnValue(chain);
    chain.insert = jest.fn().mockReturnValue(chain);
    chain.eq = jest.fn().mockReturnValue(chain);
    chain.is = jest.fn().mockReturnValue(chain);
    chain.maybeSingle = jest.fn();
    chain.single = jest.fn();

    if (table === 'evolution_strategies') {
      chain.maybeSingle.mockResolvedValue({ data: opts.strategyRow, error: null });
    } else if (table === 'topics') {
      chain.single.mockResolvedValue({ data: opts.topicRow, error: null });
    } else if (table === 'explanations') {
      chain.single.mockResolvedValue({ data: opts.explanationRow, error: null });
      chain.maybeSingle.mockResolvedValue({ data: opts.explanationRow, error: null });
    } else if (table === 'evolution_runs') {
      chain.single.mockResolvedValue({ data: opts.runRow, error: null });
    } else if (table === 'evolution_prompts') {
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
    }

    return chain;
  });

  (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);
  return supabase;
}

describe('submitPublicEditAction', () => {
  it('returns 503-style error when PUBLIC_EDIT_DISABLED=true', async () => {
    (process.env as Record<string, string | undefined>).PUBLIC_EDIT_DISABLED = 'true';
    mockSupabaseChain({});

    const result = await submitPublicEditAction({ articleText: 'hello', strategyId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' });
    expect(result?.success).toBe(false);
    expect(result?.error?.message).toMatch(/temporarily disabled/i);
  });

  it('returns 403-style error when BotID flags the request as bot', async () => {
    (process.env as Record<string, string | undefined>).BOT_PROTECTION_DISABLED = undefined;
    (checkBotId as jest.Mock).mockResolvedValueOnce({ isBot: true, isHuman: false, isVerifiedBot: false, bypassed: false });
    mockSupabaseChain({});

    const result = await submitPublicEditAction({ articleText: 'hello', strategyId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' });
    expect(result?.success).toBe(false);
    expect(result?.error?.message).toMatch(/Submission blocked/i);
  });

  it('refuses when articleText exceeds 50_000 chars', async () => {
    mockSupabaseChain({});
    const tooBig = 'x'.repeat(50_001);
    const result = await submitPublicEditAction({ articleText: tooBig, strategyId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' });
    expect(result?.success).toBe(false);
  });

  it('refuses when strategy is not in the public whitelist', async () => {
    mockSupabaseChain({ strategyRow: null });

    const result = await submitPublicEditAction({ articleText: 'hello', strategyId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' });
    expect(result?.success).toBe(false);
    expect(result?.error?.message).toMatch(/not available/i);
  });

  it('happy path: insert topic + explanation + run, returns runId', async () => {
    mockSupabaseChain({
      strategyRow: {
        id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        status: 'active',
        is_test_content: false,
        public_visible: true,
        config: {
          generationModel: 'gpt-4.1-mini',
          judgeModel: 'qwen-2.5-7b-instruct',
          iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
          budgetUsd: 0.05,
        },
      },
      topicRow: { id: 42 },
      explanationRow: { id: 99 },
      runRow: { id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' },
    });

    const result = await submitPublicEditAction({
      articleText: 'A short article to evolve.',
      strategyId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    });
    expect(result?.success).toBe(true);
    expect(result?.data?.runId).toBe('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
  });

  // Regression: `topics.topic_title` has a unique constraint, so the same
  // article submitted twice previously hit `duplicate key value violates
  // unique constraint "topics_topic_title_unique"`. The fix appends a
  // per-submission 8-char suffix to both topic and explanation titles.
  it('appends a unique per-submission suffix to topic + explanation titles so duplicate articles do not collide', async () => {
    const insertedRows: Array<{ table: string; row: Record<string, unknown> }> = [];
    const supabase = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: jest.fn((table: string): any => ({
        insert: jest.fn((row: Record<string, unknown>) => {
          insertedRows.push({ table, row });
          if (table === 'topics') return { select: () => ({ single: async () => ({ data: { id: 42 }, error: null }) }) };
          if (table === 'explanations') return { select: () => ({ single: async () => ({ data: { id: 99 }, error: null }) }) };
          if (table === 'evolution_runs') return { select: () => ({ single: async () => ({ data: { id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' }, error: null }) }) };
          return { select: () => ({ single: async () => ({ data: null, error: null }) }) };
        }),
        select: jest.fn(() => ({
          eq: jest.fn().mockReturnThis(),
          maybeSingle: async () => ({
            data: {
              id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
              status: 'active',
              is_test_content: false,
              public_visible: true,
              config: { generationModel: 'gpt-4.1-mini', judgeModel: 'qwen-2.5-7b-instruct', iterationConfigs: [], budgetUsd: 0.05 },
            },
            error: null,
          }),
          single: async () => ({ data: { id: 99 }, error: null }),
        })),
      })),
    };
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(supabase);

    const article = 'A short article to evolve.';
    const result = await submitPublicEditAction({
      articleText: article,
      strategyId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    });
    expect(result?.success).toBe(true);

    const topicRow = insertedRows.find(r => r.table === 'topics')!.row as { topic_title: string };
    const expRow = insertedRows.find(r => r.table === 'explanations')!.row as { explanation_title: string };
    // Both titles share the SAME suffix (1:1 admin matching).
    expect(topicRow.topic_title).toContain('A short article to evolve');
    expect(topicRow.topic_title).toMatch(/ · [0-9a-f]{8}$/);
    expect(expRow.explanation_title).toBe(topicRow.topic_title);
  });
});
