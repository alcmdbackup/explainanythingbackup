// Shared test mock setup for evolution service action tests.
// Consolidates the 23+ independent Supabase mock patterns into a single reusable setup.

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Mock notes ─────────────────────────────────────────────────
// jest.mock() is hoisted by Jest's babel transform to run BEFORE imports.
// This means jest.mock() factory functions cannot reference imported variables
// (they're not defined yet when the factory runs). Therefore, mock factories
// must stay inline in each test file. We share only non-hoisted helpers
// (TEST_UUIDS, setupServiceActionTest, chain mocks) which are used AFTER imports.

// ─── Standard test UUIDs ────────────────────────────────────────

export const TEST_UUIDS = {
  uuid1: '550e8400-e29b-41d4-a716-446655440000',
  uuid2: '660e8400-e29b-41d4-a716-446655440001',
  uuid3: '770e8400-e29b-41d4-a716-446655440002',
  uuid4: '880e8400-e29b-41d4-a716-446655440003',
  uuid5: '990e8400-e29b-41d4-a716-446655440004',
} as const;

// ─── beforeEach helper ──────────────────────────────────────────

/**
 * Standard beforeEach setup for service action tests.
 * Clears all mocks and wires a fresh Supabase chain mock.
 * Returns the mock for per-test configuration.
 */
export function setupServiceActionTest(defaults?: ChainMockOptions) {
  jest.clearAllMocks();
  const mockSupabase = createSupabaseChainMock(defaults);
  // Dynamic require to work after jest.mock hoisting
  const { createSupabaseServiceClient } = jest.requireMock('@/lib/utils/supabase/server') as {
    createSupabaseServiceClient: jest.Mock;
  };
  createSupabaseServiceClient.mockResolvedValue(mockSupabase);
  return { mockSupabase };
}

// ─── Deprecated ─────────────────────────────────────────────────

/**
 * @deprecated Do not use — jest.mock() inside a function body is not hoisted by Jest.
 * Use top-level jest.mock() with MOCK_IMPLEMENTATIONS factories instead.
 * Kept for reference only; will be removed in a future cleanup.
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

// ─── Table-aware chain mock ──────────────────────────────────────

/**
 * Create a Supabase mock where each .from() call gets its own isolated chain,
 * configured via ordered setup callbacks. Useful when an action makes multiple
 * .from() calls to different tables in sequence.
 *
 * @example
 * const mock = createTableAwareMock([
 *   (b) => { b.single.mockResolvedValueOnce({ data: null, error: { message: 'not found' } }); },
 *   (b) => { b.single.mockResolvedValueOnce({ data: { id: 'abc' }, error: null }); },
 * ]);
 */
export function createTableAwareMock(
  setups: Array<(builder: Record<string, jest.Mock>) => void>,
): { from: jest.Mock; rpc: jest.Mock } {
  let callIdx = 0;

  const makeBuilder = (): Record<string, jest.Mock> => {
    const b: Record<string, jest.Mock> = {};
    const chain = () => b;
    const methods = [
      'select', 'insert', 'update', 'upsert', 'delete',
      'eq', 'neq', 'in', 'is', 'or', 'ilike', 'like',
      'order', 'limit', 'range', 'single', 'maybeSingle',
      'match', 'filter', 'not', 'contains', 'gt', 'lt', 'gte', 'lte',
    ];
    for (const m of methods) {
      b[m] = jest.fn(chain);
    }
    // Make thenable for awaiting without .single()
    b.then = jest.fn((resolve: (v: unknown) => void) => resolve({ data: null, error: null }));
    return b;
  };

  return {
    from: jest.fn(() => {
      const b = makeBuilder();
      const setup = setups[callIdx];
      callIdx++;
      setup?.(b);
      return b;
    }),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  };
}
