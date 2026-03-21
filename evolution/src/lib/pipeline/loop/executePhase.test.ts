// Unit tests for the executePhase() helper that handles budget error recovery.

import { executePhase } from './runIterationLoop';
import { BudgetExceededError } from '../../types';
import { BudgetExceededWithPartialResults } from '../infra/errors';

jest.mock('../infra/trackInvocations', () => ({
  updateInvocation: jest.fn(),
}));

const { updateInvocation } = jest.requireMock('../infra/trackInvocations') as { updateInvocation: jest.Mock };

const mockDb = {} as Parameters<typeof executePhase>[2];
const makeCostTracker = (spent = 1.0) => ({ getTotalSpent: () => spent });

describe('executePhase', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns success with result on normal completion', async () => {
    const result = await executePhase(
      'generation', () => Promise.resolve(['variant-a']),
      mockDb, 'inv-1', makeCostTracker(1.5), 1.0,
    );
    expect(result).toEqual({ success: true, result: ['variant-a'] });
    expect(updateInvocation).toHaveBeenCalledWith(mockDb, 'inv-1', {
      cost_usd: 0.5, success: true,
    });
  });

  it('returns budgetExceeded on BudgetExceededError', async () => {
    const result = await executePhase(
      'ranking',
      () => { throw new BudgetExceededError('ranking', 9, 1, 10); },
      mockDb, 'inv-2', makeCostTracker(2.0), 1.5,
    );
    expect(result.success).toBe(false);
    expect(result.budgetExceeded).toBe(true);
    expect(result.partialVariants).toBeUndefined();
  });

  it('returns partialVariants on BudgetExceededWithPartialResults', async () => {
    const partials = [{ id: 'v1', text: 'partial' }];
    const result = await executePhase(
      'generation',
      () => { throw new BudgetExceededWithPartialResults(partials as never[], new BudgetExceededError('gen', 9, 1, 10)); },
      mockDb, 'inv-3', makeCostTracker(3.0), 2.0,
    );
    expect(result.success).toBe(false);
    expect(result.budgetExceeded).toBe(true);
    expect(result.partialVariants).toEqual(partials);
  });

  it('re-throws unexpected errors', async () => {
    await expect(executePhase(
      'evolution',
      () => { throw new Error('unexpected'); },
      mockDb, 'inv-4', makeCostTracker(), 0,
    )).rejects.toThrow('unexpected');
    expect(updateInvocation).not.toHaveBeenCalled();
  });

  it('BudgetExceededWithPartialResults does NOT fall through to plain BudgetExceededError branch', async () => {
    const partials = [{ id: 'v2', text: 'partial2' }];
    const result = await executePhase(
      'generation',
      () => { throw new BudgetExceededWithPartialResults(partials as never[], new BudgetExceededError('gen', 9, 1, 10)); },
      mockDb, 'inv-5', makeCostTracker(5.0), 4.0,
    );
    // Key assertion: partialVariants must be present (not lost to parent class branch)
    expect(result.partialVariants).toBeDefined();
    expect(result.partialVariants).toHaveLength(1);
  });
});
