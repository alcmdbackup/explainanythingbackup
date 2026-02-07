// Tests for content quality actions: evolution comparison (Phase E).

import { getEvolutionComparisonAction } from './contentQualityActions';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { requireAdmin } from '@/lib/services/adminAuth';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({ get: jest.fn().mockReturnValue(null) }),
}));

jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: (fn: unknown) => fn,
}));

jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: (fn: unknown) => fn,
}));

/**
 * Build a table-aware Supabase mock. The `from` call creates a fresh
 * chainable builder per table, so mocks can be set per-table.
 */
function createTableAwareMock(tableSetups: Record<string, (builder: Record<string, jest.Mock>) => void>) {
  function makeBuilder() {
    const b: Record<string, jest.Mock> = {};
    const chain = () => b;
    for (const m of ['select', 'insert', 'update', 'eq', 'gte', 'lte',
      'like', 'in', 'order', 'limit', 'single']) {
      b[m] = jest.fn(chain);
    }
    return b;
  }

  let callIdx = 0;
  const tableOrder = Object.keys(tableSetups);

  return {
    from: jest.fn((_table: string) => {
      const builder = makeBuilder();
      // Use call order since the same table might be queried twice
      const setupKey = tableOrder[callIdx] ?? _table;
      callIdx++;
      tableSetups[setupKey]?.(builder);
      return builder;
    }),
  };
}

describe('getEvolutionComparisonAction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireAdmin as jest.Mock).mockResolvedValue('admin-123');
  });

  it('returns before/after scores with improvement', async () => {
    const mock = createTableAwareMock({
      // First call: content_history
      content_history: (b) => {
        b.single.mockResolvedValueOnce({
          data: { id: 1, applied_at: '2026-01-15T12:00:00Z' },
          error: null,
        });
      },
      // Second call: content_quality_scores
      content_quality_scores: (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { dimension: 'clarity', score: 8.0, created_at: '2026-01-15T13:00:00Z' },
            { dimension: 'accuracy', score: 7.5, created_at: '2026-01-15T13:00:00Z' },
            { dimension: 'clarity', score: 6.0, created_at: '2026-01-15T11:00:00Z' },
            { dimension: 'accuracy', score: 6.5, created_at: '2026-01-15T11:00:00Z' },
          ],
          error: null,
        });
      },
    });

    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionComparisonAction(42);
    expect(result.success).toBe(true);
    expect(result.data).toBeTruthy();
    expect(result.data!.before).toEqual({ clarity: 6.0, accuracy: 6.5 });
    expect(result.data!.after).toEqual({ clarity: 8.0, accuracy: 7.5 });
    expect(result.data!.improvement).toBeCloseTo(1.5);
  });

  it('returns null when no evolution history exists', async () => {
    const mock = createTableAwareMock({
      content_history: (b) => {
        b.single.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116' } });
      },
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionComparisonAction(42);
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('returns null when no quality scores exist', async () => {
    const mock = createTableAwareMock({
      content_history: (b) => {
        b.single.mockResolvedValueOnce({
          data: { id: 1, applied_at: '2026-01-15T12:00:00Z' },
          error: null,
        });
      },
      content_quality_scores: (b) => {
        b.order.mockResolvedValueOnce({ data: [], error: null });
      },
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionComparisonAction(42);
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('returns null when scores exist only after (no before data)', async () => {
    const mock = createTableAwareMock({
      content_history: (b) => {
        b.single.mockResolvedValueOnce({
          data: { id: 1, applied_at: '2026-01-15T12:00:00Z' },
          error: null,
        });
      },
      content_quality_scores: (b) => {
        b.order.mockResolvedValueOnce({
          data: [
            { dimension: 'clarity', score: 8.0, created_at: '2026-01-15T13:00:00Z' },
          ],
          error: null,
        });
      },
    });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mock);

    const result = await getEvolutionComparisonAction(42);
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});
