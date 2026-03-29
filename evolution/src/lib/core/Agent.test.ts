// Tests for Agent abstract class: verifies run() ceremony, budget error handling, invocation tracking.

import { Agent } from './Agent';
import type { AgentContext, AgentOutput, DetailFieldDef } from './types';
import { BudgetExceededError, BudgetExceededWithPartialResults, ExecutionDetailBase } from '../types';
import { GenerationAgent } from './agents/GenerationAgent';
import { RankingAgent } from './agents/RankingAgent';
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
    },
    config: {
      iterations: 5,
      budgetUsd: 10,
      judgeModel: 'gpt-4o',
      generationModel: 'gpt-4o',
    },
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
    it('computes cost as difference in total spent', async () => {
      let callCount = 0;
      const agent = new TestAgent();
      const ctx = createMockContext();
      (ctx.costTracker.getTotalSpent as jest.Mock).mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 1.0 : 1.5; // before=1.0, after=1.5 → cost=0.5
      });

      const result = await agent.run('hello', ctx);

      expect(result.cost).toBe(0.5);
    });
  });

  describe('run() - schema validation failure', () => {
    it('warns when execution detail does not match schema, but still succeeds', async () => {
      // Return a detail with wrong shape: totalCost is a string, not a number
      const agent = new TestAgent(async () => ({
        result: 'ok',
        detail: { detailType: 'wrong', totalCost: 'not-a-number' } as any,
      }));
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      expect(result.success).toBe(true);
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
    it('writes undefined execution_detail when detail fails schema validation', async () => {
      const agent = new TestAgent(async () => ({
        result: 'ok',
        detail: { detailType: 'wrong', totalCost: 'not-a-number' } as any,
      }));
      const ctx = createMockContext();

      const result = await agent.run('hello', ctx);

      expect(result.success).toBe(true);
      // Verify that execution_detail is undefined (not the invalid detail)
      const updateCall = updateInvocation.mock.calls[0][2];
      expect(updateCall.execution_detail).toBeUndefined();
      expect(ctx.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('writing null detail to DB'),
        expect.any(Object),
      );
    });
  });

  describe('detailViewConfig on concrete agents', () => {
    it('GenerationAgent has a non-empty detailViewConfig', () => {
      const agent = new GenerationAgent();
      expect(Array.isArray(agent.detailViewConfig)).toBe(true);
      expect(agent.detailViewConfig.length).toBeGreaterThan(0);
    });

    it('RankingAgent has a non-empty detailViewConfig', () => {
      const agent = new RankingAgent();
      expect(Array.isArray(agent.detailViewConfig)).toBe(true);
      expect(agent.detailViewConfig.length).toBeGreaterThan(0);
    });
  });
});
