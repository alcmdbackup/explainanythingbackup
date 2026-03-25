// Tests for Agent abstract class: verifies run() ceremony, budget error handling, invocation tracking.

import { Agent } from './Agent';
import type { AgentContext } from './types';
import { BudgetExceededError } from '../types';
import { BudgetExceededWithPartialResults } from '../pipeline/infra/errors';
import { z } from 'zod';

// ─── Mock dependencies ──────────────────────────────────────────

jest.mock('../pipeline/infra/trackInvocations', () => ({
  createInvocation: jest.fn().mockResolvedValue('inv-123'),
  updateInvocation: jest.fn().mockResolvedValue(undefined),
}));

const { createInvocation, updateInvocation } = require('../pipeline/infra/trackInvocations');

// ─── Test agent subclass ─────────────────────────────────────────

class TestAgent extends Agent<string, string> {
  readonly name = 'test_agent';
  readonly executionDetailSchema = z.object({ detailType: z.literal('test') });
  executeFn: (input: string, ctx: AgentContext) => Promise<string>;

  constructor(executeFn?: (input: string, ctx: AgentContext) => Promise<string>) {
    super();
    this.executeFn = executeFn ?? (async (input) => `result:${input}`);
  }

  async execute(input: string, ctx: AgentContext): Promise<string> {
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
      expect(createInvocation).toHaveBeenCalledWith(
        ctx.db, 'run-123', 0, 'test_agent', 1,
      );
      expect(updateInvocation).toHaveBeenCalledWith(
        ctx.db, 'inv-123', expect.objectContaining({ success: true }),
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
          error_message: 'Error: unexpected failure',
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
});
