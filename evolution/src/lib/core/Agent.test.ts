// Tests for Agent abstract class: verifies run() ceremony, budget error handling, invocation tracking.

import { Agent } from './Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from './types';
import { BudgetExceededError, BudgetExceededWithPartialResults, ExecutionDetailBase } from '../types';
import { createCostTracker } from '../pipeline/infra/trackBudget';
import { GenerateFromPreviousArticleAgent } from './agents/generateFromPreviousArticle';
import { SwissRankingAgent } from './agents/SwissRankingAgent';
import { MergeRatingsAgent } from './agents/MergeRatingsAgent';
import { z } from 'zod';

// ─── Mock dependencies ──────────────────────────────────────────

jest.mock('../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-123'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

const { createInvocation, updateInvocation } = require('../pipeline/infra/trackInvocations');

// ─── Test detail type ─────────────────────────────────────────────

interface TestDetail extends ExecutionDetailBase {
  detailType: 'test';
}

// ─── Test agent subclass ─────────────────────────────────────────

class TestAgent extends Agent<string, string, TestDetail> {
  readonly name = 'test_agent';
  readonly executionDetailSchema = z.object({ detailType: z.literal('test'), totalCost: z.number() });
  readonly detailViewConfig: DetailFieldDef[] = [];
  executeFn: (input: string, ctx: AgentContext) => Promise<AgentOutput<string, TestDetail>>;

  constructor(executeFn?: (input: string, ctx: AgentContext) => Promise<AgentOutput<string, TestDetail>>) {
    super();
    this.executeFn = executeFn ?? (async (input) => ({
      result: `result:${input}`,
      detail: { detailType: 'test', totalCost: 0 },
    }));
  }

  async execute(input: string, ctx: AgentContext): Promise<AgentOutput<string, TestDetail>> {
    return this.executeFn(input, ctx);
  }
}

// ─── Helper to create mock context ───────────────────────────────

function createMockContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    db: {} as any,
    runId: 'run-123',
    iteration: 0,
    executionOrder: 1,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    costTracker: {
      reserve: jest.fn(),
      recordSpend: jest.fn(),
      release: jest.fn(),
      getTotalSpent: jest.fn().mockReturnValue(0.5),
      getPhaseCosts: jest.fn().mockReturnValue({}),
      getAvailableBudget: jest.fn().mockReturnValue(5),
      computeMargined: jest.fn((c: number) => c * 1.3),
      canReserve: jest.fn().mockReturnValue(true),
    },
    config: {
      iterationConfigs: [{ agentType: 'generate', budgetPercent: 60 }, { agentType: 'swiss', budgetPercent: 40 }],
      budgetUsd: 10,
      judgeModel: 'gpt-4o',
      generationModel: 'gpt-4o',
    },
    invocationId: '',
    randomSeed: BigInt(0),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('Agent abstract class', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('has correct name', () => {
    const agent = new TestAgent();
    expect(agent.name).toBe('test_agent');
  });

  describe('run() - success', () => {
    it('creates invocation, executes, updates invocation, and returns result', async () => {
      const agent = new TestAgent();
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      expect(result.success).toBe(true);
      expect(result.result).toBe('result:hello');
      expect(result.invocationId).toBe('inv-123');
      expect(typeof result.durationMs).toBe('number');
      expect(createInvocation).toHaveBeenCalledWith(
        ctx.db, 'run-123', 0, 'test_agent', 1,
        undefined, undefined,
      );
      expect(updateInvocation).toHaveBeenCalledWith(
        ctx.db, 'inv-123', expect.objectContaining({
          success: true,
          execution_detail: { detailType: 'test', totalCost: 0 },
          duration_ms: expect.any(Number),
        }),
      );
    });

    it('logs start and completion', async () => {
      const agent = new TestAgent();
      const ctx = createMockContext();

      await agent.run('hello', ctx);

      expect(ctx.logger.info).toHaveBeenCalledTimes(2);
      expect(ctx.logger.info).toHaveBeenCalledWith(
        'Agent test_agent starting',
        expect.objectContaining({ phaseName: 'test_agent' }),
      );
      expect(ctx.logger.info).toHaveBeenCalledWith(
        'Agent test_agent completed',
        expect.objectContaining({ phaseName: 'test_agent' }),
      );
    });
  });

  describe('run() - BudgetExceededError', () => {
    it('returns budget exceeded without re-throwing', async () => {
      const agent = new TestAgent(async () => {
        throw new BudgetExceededError('test', 5, 6, 10);
      });
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      expect(result.success).toBe(false);
      expect(result.budgetExceeded).toBe(true);
      expect(result.result).toBeNull();
      expect(updateInvocation).toHaveBeenCalledWith(
        ctx.db, 'inv-123', expect.objectContaining({ success: false }),
      );
    });
  });

  describe('run() - BudgetExceededWithPartialResults', () => {
    it('returns partial results', async () => {
      const partialVariants = [{ id: 'v1', text: 'partial', version: 0, parentIds: [], strategy: 'gen', createdAt: 0, iterationBorn: 0 }];
      const baseError = new BudgetExceededError('test', 5, 6, 10);
      const agent = new TestAgent(async () => {
        throw new BudgetExceededWithPartialResults(partialVariants as any, baseError);
      });
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      expect(result.success).toBe(false);
      expect(result.budgetExceeded).toBe(true);
      expect(result.partialResult).toEqual(partialVariants);
    });
  });

  describe('run() - other errors', () => {
    it('updates invocation and re-throws', async () => {
      const agent = new TestAgent(async () => {
        throw new Error('unexpected failure');
      });
      const ctx = createMockContext();

      await expect(agent.run('hello', ctx)).rejects.toThrow('unexpected failure');
      expect(updateInvocation).toHaveBeenCalledWith(
        ctx.db, 'inv-123', expect.objectContaining({
          success: false,
          error_message: 'unexpected failure',
        }),
      );
    });
  });

  describe('cost tracking', () => {
    it('cost_usd = own scope spend, not global tracker delta', async () => {
      const shared = createCostTracker(10.0);
      // Pre-load sibling spend on shared tracker (simulates parallel agent)
      const preReserve = shared.reserve('generation', 0.2);
      shared.recordSpend('generation', 0.30, preReserve);

      const agent = new TestAgent(async (_input, ctx) => {
        // This agent's one LLM call
        const reserved = ctx.costTracker.reserve('ranking', 0.05);
        ctx.costTracker.recordSpend('ranking', 0.08, reserved);
        return { result: 'ok', detail: { detailType: 'test', totalCost: 0 } };
      });

      const result = await agent.run('hello', createMockContext({ costTracker: shared }));

      // Should report only this agent's 0.08, not the global delta of 0.38
      expect(result.cost).toBeCloseTo(0.08);
    });

    it('concurrent agents: each cost_usd reflects only its own calls; A + B = totalSpent', async () => {
      const shared = createCostTracker(10.0);

      const agentA = new TestAgent(async (_input, ctx) => {
        const reserved = ctx.costTracker.reserve('generation', 0.1);
        await Promise.resolve();
        ctx.costTracker.recordSpend('generation', 0.15, reserved);
        return { result: 'A', detail: { detailType: 'test', totalCost: 0 } };
      });

      const agentB = new TestAgent(async (_input, ctx) => {
        const reserved = ctx.costTracker.reserve('ranking', 0.1);
        await Promise.resolve();
        ctx.costTracker.recordSpend('ranking', 0.20, reserved);
        return { result: 'B', detail: { detailType: 'test', totalCost: 0 } };
      });

      const [resultA, resultB] = await Promise.all([
        agentA.run('a', createMockContext({ costTracker: shared })),
        agentB.run('b', createMockContext({ costTracker: shared })),
      ]);

      expect(resultA.cost).toBeCloseTo(0.15);
      expect(resultB.cost).toBeCloseTo(0.20);
      expect(resultA.cost! + resultB.cost!).toBeCloseTo(shared.getTotalSpent());
    });

    it('sibling recordSpend injected mid-agent does not affect agent cost', async () => {
      const shared = createCostTracker(10.0);
      let injectResolve!: () => void;
      const injectPoint = new Promise<void>(resolve => { injectResolve = resolve; });

      const agentA = new TestAgent(async (_input, ctx) => {
        const reserved = ctx.costTracker.reserve('generation', 0.1);
        await injectPoint;
        ctx.costTracker.recordSpend('generation', 0.12, reserved);
        return { result: 'A', detail: { detailType: 'test', totalCost: 0 } };
      });

      const resultAPromise = agentA.run('a', createMockContext({ costTracker: shared }));

      // Inject sibling spend while A is mid-execution
      const siblingReserve = shared.reserve('ranking', 0.1);
      shared.recordSpend('ranking', 0.25, siblingReserve);
      injectResolve();

      const resultA = await resultAPromise;
      expect(resultA.cost).toBeCloseTo(0.12); // NOT 0.37
    });

    it('Bug B regression: Agent.run builds scoped LLM client from ctx.rawProvider + scope', async () => {
      // Simulates the production path: parallel agents share one tracker. Each agent is given
      // a rawProvider + defaultModel via ctx; Agent.run builds a per-invocation EvolutionLLMClient
      // bound to the scope so recordSpend hits only the agent's own scope.
      const shared = createCostTracker(10.0);

      // Three known-distinct provider responses — each agent gets one.
      const usages = [
        { promptTokens: 100, completionTokens: 100 }, // agent 0
        { promptTokens: 200, completionTokens: 200 }, // agent 1
        { promptTokens: 300, completionTokens: 300 }, // agent 2
      ];
      let callIdx = 0;
      const rawProvider = {
        async complete(_prompt: string, _label: string) {
          const idx = callIdx++;
          await new Promise((r) => setTimeout(r, 5 * (3 - idx))); // reverse ordering
          return { text: 'ok', usage: usages[idx]! };
        },
      };

      const makeAgent = () =>
        new TestAgent(async (_input: string, ctx) => {
          // Uses the scoped LLM client that Agent.run injected into input.llm
          const llm = (_input as unknown as { llm: { complete: (p: string, l: string) => Promise<string> } }).llm;
          await llm.complete('p', 'generation');
          return { result: 'ok', detail: { detailType: 'test', totalCost: 0 } };
        });

      // Pass string input with .llm shim so TestAgent's input (typed as string) still works
      // via our input rewrite path. Use `as any` since TestAgent<string, …> won't accept objects.
      const ctx = createMockContext({
        costTracker: shared,
        rawProvider,
        defaultModel: 'deepseek-chat',
      });

      const results = await Promise.all([
        makeAgent().run('{}' as unknown as string, ctx),
        makeAgent().run('{}' as unknown as string, ctx),
        makeAgent().run('{}' as unknown as string, ctx),
      ]);

      // deepseek-chat: input $0.28/1M, output $0.42/1M
      // agent i cost = (p_i * 0.28 + c_i * 0.42) / 1M
      const cost = (i: number) => (usages[i]!.promptTokens * 0.28 + usages[i]!.completionTokens * 0.42) / 1_000_000;

      // Each agent's cost_usd must equal its own expected cost — no sibling bleed.
      const sortedCosts = results.map(r => r.cost!).sort((a, b) => a - b);
      const expectedCosts = [cost(0), cost(1), cost(2)].sort((a, b) => a - b);
      expect(sortedCosts[0]).toBeCloseTo(expectedCosts[0]!, 8);
      expect(sortedCosts[1]).toBeCloseTo(expectedCosts[1]!, 8);
      expect(sortedCosts[2]).toBeCloseTo(expectedCosts[2]!, 8);

      // Shared tracker total = sum of all three (cross-check scope intercept forwards to shared)
      expect(shared.getTotalSpent()).toBeCloseTo(cost(0) + cost(1) + cost(2), 8);
    });

    it('error path: cost = spend recorded before error', async () => {
      const shared = createCostTracker(10.0);

      const agent = new TestAgent(async (_input, ctx) => {
        const reserved = ctx.costTracker.reserve('generation', 0.05);
        ctx.costTracker.recordSpend('generation', 0.07, reserved);
        throw new BudgetExceededError('generation', 0.07, 0.065, 10.0);
      });

      const result = await agent.run('hello', createMockContext({ costTracker: shared }));

      expect(result.success).toBe(false);
      expect(result.budgetExceeded).toBe(true);
      expect(result.cost).toBeCloseTo(0.07);
    });
  });

  describe('run() - schema validation failure', () => {
    it('B051: warns and marks result.success=false when execution detail does not match schema', async () => {
      // Return a detail with wrong shape: totalCost is a string, not a number
      const agent = new TestAgent(async () => ({
        result: 'ok',
        detail: { detailType: 'wrong', totalCost: 'not-a-number' } as any,
      }));
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      // B051: schema-invalid detail is now a failed invocation so dashboards see it.
      expect(result.success).toBe(false);
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('validation failed'),
        expect.any(Object),
      );
    });
  });

  describe('run() - BudgetExceededError durationMs', () => {
    it('result.durationMs is a number >= 0', async () => {
      const agent = new TestAgent(async () => {
        throw new BudgetExceededError('test', 5, 6, 10);
      });
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('run() - BudgetExceededWithPartialResults durationMs', () => {
    it('result.durationMs is a number >= 0', async () => {
      const partialVariants = [{ id: 'v1', text: 'partial', version: 0, parentIds: [], strategy: 'gen', createdAt: 0, iterationBorn: 0 }];
      const baseError = new BudgetExceededError('test', 5, 6, 10);
      const agent = new TestAgent(async () => {
        throw new BudgetExceededWithPartialResults(partialVariants as any, baseError);
      });
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('run() - detail parse failure writes null detail to DB', () => {
    it('B051: marks success=false + writes undefined execution_detail when detail fails schema validation', async () => {
      const agent = new TestAgent(async () => ({
        result: 'ok',
        detail: { detailType: 'wrong', totalCost: 'not-a-number' } as any,
      }));
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      // B051: a detail-schema failure is a data-quality bug — mark the
      // invocation as failed so it's visible in dashboards, not silently ok.
      expect(result.success).toBe(false);
      const updateCall = updateInvocation.mock.calls[0][2];
      expect(updateCall.execution_detail).toBeUndefined();
      expect(updateCall.success).toBe(false);
      expect(updateCall.error_message).toEqual(expect.any(String));
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('validation failed'),
        expect.any(Object),
      );
    });
  });

  describe('run() - threads invocationId into ctx (Critical Fix H)', () => {
    it('passes the createInvocation result through to execute() via ctx.invocationId', async () => {
      let observedInvocationId: string | undefined;
      const agent = new TestAgent(async (_input, ctx) => {
        observedInvocationId = ctx.invocationId;
        return { result: 'ok', detail: { detailType: 'test', totalCost: 0 } };
      });
      const ctx = createMockContext();
      await agent.run('hello', ctx);
      expect(observedInvocationId).toBe('inv-123');
    });

    it('passes empty string when createInvocation returns null', async () => {
      (createInvocation as jest.Mock).mockResolvedValueOnce(null);
      let observedInvocationId: string | undefined;
      const agent = new TestAgent(async (_input, ctx) => {
        observedInvocationId = ctx.invocationId;
        return { result: 'ok', detail: { detailType: 'test', totalCost: 0 } };
      });
      await agent.run('hello', createMockContext());
      expect(observedInvocationId).toBe('');
    });

    // ── FK chain test (debug_evolution_run_cost_20260426 Phase 5a) ────────────
    // This is the test that would have caught the original FK linkage bug — agents
    // call llm.complete(prompt, agentName) WITHOUT options, so the per-call
    // `options.invocationId` path is undefined; only the binding-at-construction path
    // (Phase 4a) carries the invocationId to rawProvider, where it gets forwarded
    // through to llmCallTracking.
    it('binds invocationId on the scoped EvolutionLLMClient — rawProvider receives it as options.invocationId on every complete() call', async () => {
      // Mock rawProvider in the {text, usage} shape that createEvolutionLLMClient expects.
      const rawProvider = {
        complete: jest.fn(async () => ({
          text: '# Test\n\n## Section\n\nProse with two sentences. More prose to satisfy validation.',
          usage: { promptTokens: 10, completionTokens: 5 },
        })),
      };

      // TestAgent's executeFn calls input.llm.complete WITHOUT options — simulating how
      // iteration-loop agents (e.g. GenerateFromPreviousArticleAgent) actually call it.
      const agent = new TestAgent(async (_input, _ctx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const llm = (_input as any).llm ?? (_ctx as any).llm;
        if (llm) await llm.complete('test prompt', 'generation');
        return { result: 'ok', detail: { detailType: 'test', totalCost: 0 } };
      });

      const ctx = createMockContext({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawProvider: rawProvider as any,
        defaultModel: 'gpt-4o',
      });

      await agent.run('input', ctx);

      // Assert the rawProvider received invocationId in its options arg — the bound
      // value flowing through the scoped client at Agent.ts:69 → createEvolutionLLMClient.
      expect(rawProvider.complete).toHaveBeenCalledWith(
        'test prompt',
        'generation',
        expect.objectContaining({ invocationId: 'inv-123' }),
      );
    });

    // ── Kill-switch coverage (Phase 5a-bis) ───────────────────────────────────
    it('omits invocationId binding when EVOLUTION_FK_THREADING_ENABLED=false', async () => {
      const savedEnv = process.env.EVOLUTION_FK_THREADING_ENABLED;
      process.env.EVOLUTION_FK_THREADING_ENABLED = 'false';
      try {
        const rawProvider = {
          complete: jest.fn(async () => ({
            text: '# Test\n\n## Section\n\nProse one. Prose two.',
            usage: { promptTokens: 10, completionTokens: 5 },
          })),
        };
        const agent = new TestAgent(async (_input, _ctx) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const llm = (_input as any).llm ?? (_ctx as any).llm;
          if (llm) await llm.complete('test prompt', 'generation');
          return { result: 'ok', detail: { detailType: 'test', totalCost: 0 } };
        });
        const ctx = createMockContext({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rawProvider: rawProvider as any,
          defaultModel: 'gpt-4o',
        });
        await agent.run('input', ctx);

        // Kill switch active → bound invocationId is undefined → rawProvider receives undefined.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const callArgs = rawProvider.complete.mock.calls[0] as any;
        expect(callArgs?.[2]?.invocationId).toBeUndefined();
      } finally {
        if (savedEnv === undefined) delete process.env.EVOLUTION_FK_THREADING_ENABLED;
        else process.env.EVOLUTION_FK_THREADING_ENABLED = savedEnv;
      }
    });
  });

  describe('detailViewConfig on concrete agents', () => {
    it('GenerateFromPreviousArticleAgent has a non-empty detailViewConfig', () => {
      const agent = new GenerateFromPreviousArticleAgent();
      expect(Array.isArray(agent.detailViewConfig)).toBe(true);
      expect(agent.detailViewConfig.length).toBeGreaterThan(0);
    });

    it('SwissRankingAgent has a non-empty detailViewConfig', () => {
      const agent = new SwissRankingAgent();
      expect(Array.isArray(agent.detailViewConfig)).toBe(true);
      expect(agent.detailViewConfig.length).toBeGreaterThan(0);
    });

    it('MergeRatingsAgent has a non-empty detailViewConfig', () => {
      const agent = new MergeRatingsAgent();
      expect(Array.isArray(agent.detailViewConfig)).toBe(true);
      expect(agent.detailViewConfig.length).toBeGreaterThan(0);
    });
  });

  describe('getAttributionDimension (Phase 5)', () => {
    it('GenerateFromPreviousArticleAgent returns detail.tactic', () => {
      const agent = new GenerateFromPreviousArticleAgent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = agent.getAttributionDimension({ tactic: 'lexical_simplify' } as any);
      expect(result).toBe('lexical_simplify');
    });

    it('GenerateFromPreviousArticleAgent returns null when tactic absent', () => {
      const agent = new GenerateFromPreviousArticleAgent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = agent.getAttributionDimension({} as any);
      expect(result).toBeNull();
    });

    it('SwissRankingAgent returns null (default — no attribution)', () => {
      const agent = new SwissRankingAgent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = agent.getAttributionDimension({} as any);
      expect(result).toBeNull();
    });

    it('MergeRatingsAgent returns null (default — no attribution)', () => {
      const agent = new MergeRatingsAgent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = agent.getAttributionDimension({} as any);
      expect(result).toBeNull();
    });
  });
});
