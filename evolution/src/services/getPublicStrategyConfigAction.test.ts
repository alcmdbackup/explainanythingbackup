// Security boundary test for the new public server action added by
// improvements_to_edit_page_evolution_20260630 Phase 1.
// Verifies the widened submittability re-check runs against every request
// so a strategy that has left the picker set between page load + modal open
// cannot leak its config.

// Match the module-level 'use server' pragma pattern by mocking Supabase.
import { getPublicStrategyConfigAction } from './strategyRegistryActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { NotPubliclySubmittableError } from './publicStrategyFilter';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

const TEST_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
  jest.clearAllMocks();
  delete (process.env as Record<string, string | undefined>).PUBLIC_EDIT_WIDEN_FILTER;
});

afterAll(() => { process.env = originalEnv; });

function mockRow(row: unknown): void {
  (createSupabaseServiceClient as jest.Mock).mockResolvedValue({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
        }),
      }),
    }),
  });
}

describe('getPublicStrategyConfigAction', () => {
  it('returns full StrategyConfig for a submittable row (widen=true)', async () => {
    (process.env as Record<string, string | undefined>).PUBLIC_EDIT_WIDEN_FILTER = 'true';
    mockRow({
      id: TEST_ID,
      status: 'active',
      is_test_content: false,
      public_visible: false,
      config: {
        generationModel: 'gpt-4.1-mini',
        judgeModel: 'qwen-2.5-7b-instruct',
        iterationConfigs: [{ agentType: 'generate', budgetPercent: 100 }],
        budgetUsd: 0.05,
      },
    });
    const result = await getPublicStrategyConfigAction(TEST_ID);
    expect(result?.success).toBe(true);
    expect(result?.data?.generationModel).toBe('gpt-4.1-mini');
    expect(result?.data?.budgetUsd).toBe(0.05);
  });

  it('rejects mock-model strategy (MOCK_MODEL code)', async () => {
    (process.env as Record<string, string | undefined>).PUBLIC_EDIT_WIDEN_FILTER = 'true';
    mockRow({
      id: TEST_ID,
      status: 'active',
      is_test_content: false,
      public_visible: true,
      config: { generationModel: 'mock', judgeModel: 'mock', iterationConfigs: [], budgetUsd: 0.01 },
    });
    const result = await getPublicStrategyConfigAction(TEST_ID);
    expect(result?.success).toBe(false);
    expect(result?.error?.message).toMatch(/mock/i);
  });

  it('rejects archived strategy (STATUS code)', async () => {
    (process.env as Record<string, string | undefined>).PUBLIC_EDIT_WIDEN_FILTER = 'true';
    mockRow({
      id: TEST_ID,
      status: 'archived',
      is_test_content: false,
      public_visible: true,
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'qwen', iterationConfigs: [], budgetUsd: 0.05 },
    });
    const result = await getPublicStrategyConfigAction(TEST_ID);
    expect(result?.success).toBe(false);
  });

  it('rejects test-content strategy (TEST_CONTENT code)', async () => {
    (process.env as Record<string, string | undefined>).PUBLIC_EDIT_WIDEN_FILTER = 'true';
    mockRow({
      id: TEST_ID,
      status: 'active',
      is_test_content: true,
      public_visible: true,
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'qwen', iterationConfigs: [], budgetUsd: 0.05 },
    });
    const result = await getPublicStrategyConfigAction(TEST_ID);
    expect(result?.success).toBe(false);
  });

  it('with widen=false: rejects non-public_visible strategy (PUBLIC_VISIBLE code)', async () => {
    delete (process.env as Record<string, string | undefined>).PUBLIC_EDIT_WIDEN_FILTER;
    mockRow({
      id: TEST_ID,
      status: 'active',
      is_test_content: false,
      public_visible: false,
      config: { generationModel: 'gpt-4.1-mini', judgeModel: 'qwen', iterationConfigs: [], budgetUsd: 0.05 },
    });
    const result = await getPublicStrategyConfigAction(TEST_ID);
    expect(result?.success).toBe(false);
  });

  it('returns error for unknown strategyId', async () => {
    (process.env as Record<string, string | undefined>).PUBLIC_EDIT_WIDEN_FILTER = 'true';
    mockRow(null);
    const result = await getPublicStrategyConfigAction(TEST_ID);
    expect(result?.success).toBe(false);
    expect(result?.error?.message).toMatch(/not found/i);
  });

  it('rejects malformed strategyId', async () => {
    const result = await getPublicStrategyConfigAction('not-a-uuid');
    expect(result?.success).toBe(false);
    expect(result?.error?.message).toMatch(/invalid.*strategyId/i);
  });
});

// Sanity: NotPubliclySubmittableError codes exist and are stable.
describe('NotPubliclySubmittableError', () => {
  it('has stable code enum', () => {
    const codes: Array<'STATUS' | 'TEST_CONTENT' | 'MOCK_MODEL' | 'PUBLIC_VISIBLE'> = [
      'STATUS', 'TEST_CONTENT', 'MOCK_MODEL', 'PUBLIC_VISIBLE',
    ];
    for (const code of codes) {
      const e = new NotPubliclySubmittableError(code, 'test');
      expect(e.code).toBe(code);
      expect(e.name).toBe('NotPubliclySubmittableError');
    }
  });
});
