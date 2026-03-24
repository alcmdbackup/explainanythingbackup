// Integration test for Bug #6: server-side budget validation via Zod in addRunToExperimentAction.
// Verifies that budget_cap_usd is rejected when > $10 or <= 0, and accepted for valid values.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';
import { createSupabaseChainMock } from '@evolution/testing/service-test-mocks';

// ─── Mocks (must be before imports of modules under test) ────

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

const mockAddRunToExperiment = jest.fn();

jest.mock('@evolution/lib/pipeline/manageExperiments', () => ({
  createExperiment: jest.fn(),
  addRunToExperiment: (...args: unknown[]) => mockAddRunToExperiment(...args),
  computeExperimentMetrics: jest.fn(),
}));

import { addRunToExperimentAction } from '@evolution/services/experimentActions';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_STRATEGY_UUID = '660e8400-e29b-41d4-a716-446655440001';

// ─── Tests ───────────────────────────────────────────────────

describe('Evolution Budget Constraint Integration (Bug #6)', () => {
  let mockSupabase: ReturnType<typeof createSupabaseChainMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabase = createSupabaseChainMock({ data: null, error: null });
    (createSupabaseServiceClient as jest.Mock).mockResolvedValue(mockSupabase);
    mockAddRunToExperiment.mockResolvedValue({ runId: 'run-new' });
  });

  // ─── Rejection: budget > $10 ────────────────────────────────

  it('rejects budget > $10 via Zod validation', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 15 },
    });

    expect(result.success).toBe(false);
    expect(mockAddRunToExperiment).not.toHaveBeenCalled();
  });

  it('rejects budget exactly at $10.01', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 10.01 },
    });

    expect(result.success).toBe(false);
    expect(mockAddRunToExperiment).not.toHaveBeenCalled();
  });

  it('rejects budget of $100', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 100 },
    });

    expect(result.success).toBe(false);
    expect(mockAddRunToExperiment).not.toHaveBeenCalled();
  });

  // ─── Rejection: budget <= 0 ─────────────────────────────────

  it('rejects budget of $0 via Zod positive() check', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 0 },
    });

    expect(result.success).toBe(false);
    expect(mockAddRunToExperiment).not.toHaveBeenCalled();
  });

  it('rejects negative budget', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: -5 },
    });

    expect(result.success).toBe(false);
    expect(mockAddRunToExperiment).not.toHaveBeenCalled();
  });

  it('rejects budget of -0.01', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: -0.01 },
    });

    expect(result.success).toBe(false);
    expect(mockAddRunToExperiment).not.toHaveBeenCalled();
  });

  // ─── Acceptance: valid budget range ─────────────────────────

  it('accepts budget of $0.01 (minimum valid)', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 0.01 },
    });

    expect(result.success).toBe(true);
    expect(mockAddRunToExperiment).toHaveBeenCalledWith(
      VALID_UUID,
      { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 0.01 },
      mockSupabase,
    );
  });

  it('accepts budget of $5 (mid-range)', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 5 },
    });

    expect(result.success).toBe(true);
    expect(mockAddRunToExperiment).toHaveBeenCalled();
  });

  it('accepts budget of exactly $10 (maximum valid)', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 10 },
    });

    expect(result.success).toBe(true);
    expect(mockAddRunToExperiment).toHaveBeenCalledWith(
      VALID_UUID,
      { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 10 },
      mockSupabase,
    );
  });

  // ─── Edge cases ─────────────────────────────────────────────

  it('rejects non-UUID experimentId even with valid budget', async () => {
    const result = await addRunToExperimentAction({
      experimentId: 'not-a-uuid',
      config: { strategy_id: VALID_STRATEGY_UUID, budget_cap_usd: 5 },
    });

    expect(result.success).toBe(false);
    expect(mockAddRunToExperiment).not.toHaveBeenCalled();
  });

  it('rejects non-UUID strategy_id even with valid budget', async () => {
    const result = await addRunToExperimentAction({
      experimentId: VALID_UUID,
      config: { strategy_id: 'bad-strategy', budget_cap_usd: 5 },
    });

    expect(result.success).toBe(false);
    expect(mockAddRunToExperiment).not.toHaveBeenCalled();
  });
});
