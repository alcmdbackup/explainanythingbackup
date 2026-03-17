// Tests for variant detail server actions: verifies requireAdmin is called and Supabase queries are executed.

import { getVariantFullDetailAction, getVariantParentsAction, getVariantChildrenAction, getVariantMatchHistoryAction, getVariantLineageChainAction } from './variantDetailActions';

jest.mock('@/lib/utils/supabase/server', () => {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockReturnValue(chain);
  chain.not = jest.fn().mockReturnValue(chain);
  chain.is = jest.fn().mockReturnValue(chain);
  chain.order = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue({ data: { id: 'v-1', run_id: 'r-1', explanation_id: 42, variant_content: 'test', elo_score: 1200, generation: 1, agent_name: 'iterativeEditing', match_count: 5, is_winner: false, parent_variant_id: null, elo_attribution: null, created_at: '2026-01-01', status: 'completed' }, error: null });
  chain.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.head = jest.fn().mockResolvedValue({ count: 0, data: null, error: null });
  return { createSupabaseServiceClient: jest.fn().mockResolvedValue(chain) };
});

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: (...args: unknown[]) => unknown, _name: string) => fn,
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: (...args: unknown[]) => unknown) => fn,
}));

describe('variantDetailActions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getVariantFullDetailAction calls requireAdmin', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    await getVariantFullDetailAction('v-1');
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('getVariantFullDetailAction queries evolution_variants', async () => {
    const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    await getVariantFullDetailAction('v-1');
    expect(supabase.from).toHaveBeenCalledWith('evolution_variants');
  });

  it('getVariantParentsAction calls requireAdmin', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    await getVariantParentsAction('v-1');
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('getVariantParentsAction queries evolution_variants', async () => {
    const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    await getVariantParentsAction('v-1');
    expect(supabase.from).toHaveBeenCalledWith('evolution_variants');
  });

  it('getVariantChildrenAction calls requireAdmin', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    await getVariantChildrenAction('v-1');
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('getVariantChildrenAction queries evolution_variants', async () => {
    const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    await getVariantChildrenAction('v-1');
    expect(supabase.from).toHaveBeenCalledWith('evolution_variants');
  });

  it('getVariantMatchHistoryAction calls requireAdmin', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    await getVariantMatchHistoryAction('v-1');
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('getVariantMatchHistoryAction returns empty array (V2: no checkpoint match history)', async () => {
    const result = await getVariantMatchHistoryAction('v-1');
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('getVariantLineageChainAction calls requireAdmin', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    await getVariantLineageChainAction('v-1');
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('getVariantLineageChainAction queries evolution_variants', async () => {
    const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    await getVariantLineageChainAction('v-1');
    expect(supabase.from).toHaveBeenCalledWith('evolution_variants');
  });
});
