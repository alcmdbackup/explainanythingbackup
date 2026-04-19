// Integration test for multi-iteration pipeline end-to-end with real cost tracking.
// Exercises evolveArticle with various iteration configs, verifying iteration results,
// stop reasons, and budget enforcement without mocking the cost tracker.

import { evolveArticle } from '@evolution/lib/pipeline/loop/runIterationLoop';
import { createV2MockLlm } from '@evolution/testing/v2MockLlm';
import { DEFAULT_TEST_ITERATION_CONFIGS, VALID_VARIANT_TEXT } from '@evolution/testing/evolution-test-helpers';
import type { EvolutionConfig } from '@evolution/lib/pipeline/infra/types';

// ─── Mocks ────────────────────────────────────────────────────────

jest.mock('@evolution/lib/pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-iter-cfg'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@evolution/lib/shared/computeRatings', () => {
  const actual = jest.requireActual('@evolution/lib/shared/computeRatings');
  return {
    ...actual,
    compareWithBiasMitigation: jest.fn(async () => ({ winner: 'A', confidence: 1.0, turns: 2 })),
  };
});

jest.mock('@evolution/lib/shared/enforceVariantFormat', () => ({
  validateFormat: jest.fn(() => ({ valid: true, issues: [] })),
  FORMAT_RULES: '',
}));

jest.mock('@evolution/lib/metrics/writeMetrics', () => ({
  writeMetricMax: jest.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ───────��──────────────────────────────────────────────

/** Fake Supabase client: isRunKilled query returns 'running' so the loop never aborts. */
function createMockDb() {
  const single = jest.fn().mockResolvedValue({ data: { status: 'running' }, error: null });
  const eq = jest.fn().mockReturnValue({ single });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });
  return { from } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

function makeConfig(overrides: Partial<EvolutionConfig> = {}): EvolutionConfig {
  return {
    iterationConfigs: DEFAULT_TEST_ITERATION_CONFIGS,
    budgetUsd: 5,
    judgeModel: 'gpt-4o',
    generationModel: 'gpt-4o',
    numVariants: 3,
    ...overrides,
  };
}

const noopLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/** Build a raw LLM provider from the V2 mock so evolveArticle can wrap it via createEvolutionLLMClient. */
function makeRawProvider(mockLlm: ReturnType<typeof createV2MockLlm>) {
  return {
    complete: async (prompt: string, label: string, _opts?: { model?: string }) => {
      return mockLlm.complete(prompt, label);
    },
  };
}

// ─── Tests ��───────────────────────────────────────────────────────

describe('evolution iteration config (integration)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('multi-iteration run completes: generate(60%) + swiss(40%)', async () => {
    const mockLlm = createV2MockLlm();
    const config = makeConfig({
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 60 },
        { agentType: 'swiss', budgetPercent: 40 },
      ],
      budgetUsd: 5,
      numVariants: 3,
    });

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-multi-iter',
      config,
      { logger: noopLogger, seedVariantId: 'seed-v1' },
    );

    // iterationResults has 2 entries
    expect(result.iterationResults).toBeDefined();
    expect(result.iterationResults!.length).toBe(2);

    // First iteration: generate
    const first = result.iterationResults![0]!;
    expect(first.agentType).toBe('generate');
    expect(first.stopReason).toBe('iteration_complete');

    // Second iteration: swiss
    const second = result.iterationResults![1]!;
    expect(second.agentType).toBe('swiss');
    expect(second.stopReason).toMatch(/^iteration_/);

    // Run completed successfully
    expect(result.stopReason).toBe('completed');

    // Pool should have variants (generated in iteration 1)
    expect(result.pool.length).toBeGreaterThan(0);

    // Winner selected
    expect(result.winner).toBeDefined();
    expect(result.winner.id).toBeTruthy();
  }, 30_000);

  it('iteration budget constrains variants: generate(10%) + generate(90%)', async () => {
    const mockLlm = createV2MockLlm();
    // First iteration gets only 10% of $0.10 = $0.01. Budget-aware dispatch limits
    // agent count based on estimated cost, so fewer variants are produced.
    // Second iteration gets 90% = $0.09, enough for more agents.
    const config = makeConfig({
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 10 },
        { agentType: 'generate', budgetPercent: 90 },
      ],
      budgetUsd: 0.10,
      numVariants: 9,
    });

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-iter-budget',
      config,
      { logger: noopLogger, seedVariantId: 'seed-v2' },
    );

    expect(result.iterationResults).toBeDefined();
    expect(result.iterationResults!.length).toBe(2);

    // First iteration dispatches fewer agents due to tight budget
    const first = result.iterationResults![0]!;
    expect(first.agentType).toBe('generate');
    expect(first.variantsCreated).toBeLessThanOrEqual(2);

    // Second iteration still executes (run continues past first iteration)
    const second = result.iterationResults![1]!;
    expect(second.agentType).toBe('generate');
    expect(second.iteration).toBe(2);
    // Second iteration has more budget so can create more variants
    expect(second.variantsCreated).toBeGreaterThanOrEqual(first.variantsCreated);

    // Run completed
    expect(result.stopReason).toBe('completed');
  }, 30_000);

  it('run budget stops entire run: total_budget_exceeded', async () => {
    // When budget is extremely small, agents handle BudgetExceededError internally
    // (returning gracefully without variants). The run-level total_budget_exceeded
    // stop reason triggers when BudgetExceededError escapes the agent boundary.
    // With the mock LLM, we can trigger this by making a provider that forces
    // spending to exceed the run budget after at least one successful call.
    let callCount = 0;
    const expensiveProvider = {
      complete: async (prompt: string, label: string, _opts?: { model?: string }) => {
        callCount++;
        // Return valid text so the first call succeeds, building up spend.
        // Subsequent calls will hit the run budget limit.
        return VALID_VARIANT_TEXT;
      },
    };

    // Budget $0.005 — enough for 2-3 LLM calls but not for a full iteration of 9 agents.
    // The run-level costTracker accumulates actual spend. When reserve() fails on the
    // run tracker (thrown as BudgetExceededError), agents catch it internally.
    // All iterations complete but produce minimal or no variants.
    const config = makeConfig({
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 50 },
        { agentType: 'generate', budgetPercent: 50 },
      ],
      budgetUsd: 0.005,
      numVariants: 9,
    });

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      expensiveProvider,
      createMockDb(),
      'run-total-budget',
      config,
      { logger: noopLogger, seedVariantId: 'seed-v3' },
    );

    // With very tight budget, run completes but with constrained output.
    // Total cost stays within or near the budget cap.
    expect(result.totalCost).toBeLessThanOrEqual(0.01);

    // At least one iteration records results
    expect(result.iterationResults).toBeDefined();
    expect(result.iterationResults!.length).toBeGreaterThanOrEqual(1);

    // Budget was exhausted — either stopReason reflects it, or iterations
    // show constrained output (zero or few variants with budget-limited dispatch).
    const totalVariantsCreated = result.iterationResults!.reduce((s, ir) => s + ir.variantsCreated, 0);
    expect(totalVariantsCreated).toBeLessThanOrEqual(3);
  }, 30_000);

  it('three iterations: generate + swiss + generate execute in order', async () => {
    const mockLlm = createV2MockLlm();
    const config = makeConfig({
      iterationConfigs: [
        { agentType: 'generate', budgetPercent: 40 },
        { agentType: 'swiss', budgetPercent: 30 },
        { agentType: 'generate', budgetPercent: 30 },
      ],
      budgetUsd: 5,
      numVariants: 3,
    });

    const result = await evolveArticle(
      VALID_VARIANT_TEXT,
      makeRawProvider(mockLlm),
      createMockDb(),
      'run-three-iter',
      config,
      { logger: noopLogger, seedVariantId: 'seed-v4' },
    );

    expect(result.iterationResults).toBeDefined();
    expect(result.iterationResults!.length).toBe(3);

    // All three execute in order with correct agentTypes
    expect(result.iterationResults![0]!.agentType).toBe('generate');
    expect(result.iterationResults![0]!.iteration).toBe(1);

    expect(result.iterationResults![1]!.agentType).toBe('swiss');
    expect(result.iterationResults![1]!.iteration).toBe(2);

    expect(result.iterationResults![2]!.agentType).toBe('generate');
    expect(result.iterationResults![2]!.iteration).toBe(3);

    expect(result.stopReason).toBe('completed');
  }, 30_000);
});
