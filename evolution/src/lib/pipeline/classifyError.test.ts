// Tests for classifyError: BudgetExceededError with phase hints, wall clock, killed,
// fallback to unhandled_error.

import { classifyError } from './classifyError';
import { BudgetExceededError, BudgetExceededWithPartialResults } from '../types';

describe('classifyError', () => {
  it('returns budget_exceeded_during_generate for BudgetExceededError without phase', () => {
    const e = new BudgetExceededError('agent', 5, 6, 10);
    expect(classifyError(e)).toBe('budget_exceeded_during_generate');
  });

  it('returns budget_exceeded_during_swiss when phase=swiss', () => {
    const e = new BudgetExceededError('agent', 5, 6, 10);
    expect(classifyError(e, 'swiss')).toBe('budget_exceeded_during_swiss');
  });

  it('returns budget_exceeded_before_first_variant when phase=setup', () => {
    const e = new BudgetExceededError('agent', 5, 6, 10);
    expect(classifyError(e, 'setup')).toBe('budget_exceeded_before_first_variant');
  });

  it('treats BudgetExceededWithPartialResults as budget error', () => {
    const base = new BudgetExceededError('agent', 5, 6, 10);
    const e = new BudgetExceededWithPartialResults({}, base);
    expect(classifyError(e, 'generate')).toBe('budget_exceeded_during_generate');
  });

  it('returns wall_clock_deadline_exceeded for deadline errors', () => {
    expect(classifyError(new Error('Wall clock deadline reached'))).toBe('wall_clock_deadline_exceeded');
    expect(classifyError(new Error('Deadline exceeded'))).toBe('wall_clock_deadline_exceeded');
  });

  it('returns killed_externally for kill/cancel/abort messages', () => {
    expect(classifyError(new Error('Run was killed'))).toBe('killed_externally');
    expect(classifyError(new Error('Cancelled by admin'))).toBe('killed_externally');
    expect(classifyError(new Error('Operation aborted'))).toBe('killed_externally');
  });

  it('returns budget_too_small for "budget too small" errors', () => {
    expect(classifyError(new Error('Budget too small for any work'))).toBe('budget_too_small');
  });

  it('returns missing_seed_article when seed article is missing', () => {
    expect(classifyError(new Error('Missing seed article for run'))).toBe('missing_seed_article');
  });

  it('returns invalid_config for config validation errors', () => {
    expect(classifyError(new Error('Invalid config: budgetUsd negative'))).toBe('invalid_config');
  });

  it('returns merge_agent_crashed when phase=merge', () => {
    expect(classifyError(new Error('something exploded'), 'merge')).toBe('merge_agent_crashed');
  });

  it('falls back to unhandled_error for unknown errors', () => {
    expect(classifyError(new Error('something weird'))).toBe('unhandled_error');
    expect(classifyError(null)).toBe('unhandled_error');
    expect(classifyError({ random: 'object' })).toBe('unhandled_error');
  });
});
