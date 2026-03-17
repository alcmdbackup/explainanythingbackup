// Shared test mock setup for evolution service action tests.
// Consolidates the 23+ independent Supabase mock patterns into a single reusable setup.

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Auto-mock setup ─────────────────────────────────────────────

/**
 * Set up standard mocks for service tests. Call in beforeEach or at module level.
 * Mocks: createSupabaseServiceClient, requireAdmin, withLogging, serverReadRequestId.
 */
export function setupServiceTestMocks() {
  jest.mock('@/lib/utils/supabase/server', () => ({
    createSupabaseServiceClient: jest.fn(),
  }));

  jest.mock('@/lib/services/adminAuth', () => ({
    requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
  }));

  jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
    withLogging: jest.fn((fn: unknown) => fn),
  }));

  jest.mock('@/lib/serverReadRequestId', () => ({
    serverReadRequestId: jest.fn((fn: unknown) => fn),
  }));
}

// ─── Supabase chain mock ─────────────────────────────────────────

interface ChainMockOptions {
  /** Data to return from .single() or terminal query. */
  data?: unknown;
  /** Error to return. */
  error?: { message: string; code?: string } | null;
  /** Count to return (for count queries). */
  count?: number;
}

/**
 * Create a chainable Supabase mock that supports common query patterns.
 * Supports: from().select().eq().single(), from().insert().select().single(),
 * from().update().eq(), from().delete().eq(), from().upsert(), rpc().
 */
export function createSupabaseChainMock(
  defaults?: ChainMockOptions,
): jest.Mocked<SupabaseClient> {
  const resolvedData = defaults?.data ?? null;
  const resolvedError = defaults?.error ?? null;

  const terminalResult = { data: resolvedData, error: resolvedError, count: defaults?.count ?? 0 };

  const chainable = (): Record<string, jest.Mock> => {
    const obj: Record<string, jest.Mock> = {};
    const methods = ['select', 'eq', 'neq', 'in', 'is', 'gt', 'lt', 'gte', 'lte', 'like', 'ilike',
      'order', 'limit', 'range', 'single', 'maybeSingle', 'match', 'filter', 'not', 'or', 'contains',
      'overlaps', 'textSearch'];

    for (const method of methods) {
      obj[method] = jest.fn().mockReturnValue(obj);
    }
    // Terminal methods return the result
    obj.single = jest.fn().mockResolvedValue(terminalResult);
    obj.maybeSingle = jest.fn().mockResolvedValue(terminalResult);
    // Make the chain itself thenable (for queries without .single())
    obj.then = jest.fn((resolve) => resolve(terminalResult));
    return obj;
  };

  const chain = chainable();

  return {
    from: jest.fn(() => ({
      ...chain,
      insert: jest.fn(() => chain),
      update: jest.fn(() => chain),
      delete: jest.fn(() => chain),
      upsert: jest.fn(() => chain),
    })),
    rpc: jest.fn().mockResolvedValue(terminalResult),
  } as unknown as jest.Mocked<SupabaseClient>;
}
