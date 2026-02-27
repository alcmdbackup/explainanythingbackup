// Tests for article detail server actions: verifies requireAdmin is called and Supabase queries are executed.

import { getArticleOverviewAction, getArticleRunsAction, getArticleVariantsAction } from './articleDetailActions';

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
  chain.single = jest.fn().mockResolvedValue({ data: { id: 1, title: 'Test' }, error: null });
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

describe('articleDetailActions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('getArticleOverviewAction calls requireAdmin', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    await getArticleOverviewAction(42);
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('getArticleOverviewAction queries explanations table', async () => {
    const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    await getArticleOverviewAction(42);
    expect(supabase.from).toHaveBeenCalledWith('explanations');
  });

  it('getArticleRunsAction calls requireAdmin', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    await getArticleRunsAction(42);
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('getArticleRunsAction queries evolution_runs table', async () => {
    const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    await getArticleRunsAction(42);
    expect(supabase.from).toHaveBeenCalledWith('evolution_runs');
  });

  it('getArticleVariantsAction calls requireAdmin', async () => {
    const { requireAdmin } = jest.requireMock('@/lib/services/adminAuth');
    await getArticleVariantsAction(42);
    expect(requireAdmin).toHaveBeenCalled();
  });

  it('getArticleVariantsAction queries evolution_variants', async () => {
    const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();
    await getArticleVariantsAction(42);
    expect(supabase.from).toHaveBeenCalledWith('evolution_variants');
  });
});
