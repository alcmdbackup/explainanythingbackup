// Property-based tests for the V2 budget tracker — validates core invariants:
// totalSpent + totalReserved ≤ budgetUsd, reserve margin, reserve-spend swap, phase accumulation.

import * as fc from 'fast-check';
import { createCostTracker } from './trackBudget';
import type { AgentName } from '../../core/agentNames';

describe('trackBudget property tests', () => {
  it('core invariant: totalSpent + reserved ≤ budgetUsd after any operation sequence', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 50, noNaN: true }),
        fc.array(
          fc.record({
            phase: fc.constantFrom<AgentName>('generation', 'ranking'),
            estimatedCost: fc.double({ min: 0.0001, max: 0.1, noNaN: true }),
            actualFraction: fc.double({ min: 0.5, max: 1.5, noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (budgetUsd, ops) => {
          const tracker = createCostTracker(budgetUsd);
          const reservations: { phase: AgentName; reserved: number }[] = [];

          for (const op of ops) {
            try {
              const reserved = tracker.reserve(op.phase, op.estimatedCost);
              reservations.push({ phase: op.phase, reserved });

              const actual = op.estimatedCost * op.actualFraction;
              tracker.recordSpend(op.phase, actual, reserved);
            } catch {
              // BudgetExceededError is expected — invariant still holds
            }
          }

          // After all ops, available should be non-negative (budget not exceeded structurally)
          expect(tracker.getAvailableBudget()).toBeGreaterThanOrEqual(-0.001);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reserve returns exactly cost * 1.3', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (cost) => {
          const tracker = createCostTracker(100);
          const reserved = tracker.reserve('generation',cost);
          expect(reserved).toBeCloseTo(cost * 1.3, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('reserve-spend swap: available changes by (reserved - actual)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        fc.double({ min: 0.5, max: 1.5, noNaN: true }),
        (estimatedCost, fraction) => {
          const tracker = createCostTracker(100);
          const availableBefore = tracker.getAvailableBudget();
          const reserved = tracker.reserve('generation',estimatedCost);
          const actual = estimatedCost * fraction;
          tracker.recordSpend('generation',actual, reserved);
          const availableAfter = tracker.getAvailableBudget();

          // available should decrease by actual cost (reservation released, actual added)
          expect(availableAfter).toBeCloseTo(availableBefore - actual, 6);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('phase cost accumulation: sum(phaseCosts) === totalSpent', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            phase: fc.constantFrom<AgentName>('generation', 'ranking'),
            cost: fc.double({ min: 0.0001, max: 0.1, noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (ops) => {
          const tracker = createCostTracker(100);

          for (const op of ops) {
            const reserved = tracker.reserve(op.phase, op.cost);
            tracker.recordSpend(op.phase, op.cost, reserved);
          }

          const phaseCosts = tracker.getPhaseCosts();
          const sumPhases = Object.values(phaseCosts).reduce((a, b) => a + b, 0);
          expect(sumPhases).toBeCloseTo(tracker.getTotalSpent(), 6);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('release restores available budget', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        (estimatedCost) => {
          const tracker = createCostTracker(100);
          const availableBefore = tracker.getAvailableBudget();
          const reserved = tracker.reserve('generation',estimatedCost);
          tracker.release('generation',reserved);
          const availableAfter = tracker.getAvailableBudget();
          expect(availableAfter).toBeCloseTo(availableBefore, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('budget exceeded throws when reserve exceeds remaining', () => {
    const tracker = createCostTracker(0.01);
    expect(() => tracker.reserve('generation',1.0)).toThrow();
  });

  it('rejects negative budget', () => {
    expect(() => createCostTracker(-1)).toThrow('budgetUsd must be a positive finite number');
  });

  it('rejects NaN budget', () => {
    expect(() => createCostTracker(NaN)).toThrow('budgetUsd must be a positive finite number');
  });

  it('rejects Infinity budget', () => {
    expect(() => createCostTracker(Infinity)).toThrow('budgetUsd must be a positive finite number');
  });

  it('rejects zero budget', () => {
    expect(() => createCostTracker(0)).toThrow('budgetUsd must be a positive finite number');
  });
});
