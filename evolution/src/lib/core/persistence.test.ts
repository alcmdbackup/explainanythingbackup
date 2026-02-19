// Unit tests for persistence module: markRunFailed and markRunPaused with mocked supabase.

import { markRunFailed, markRunPaused } from './persistence';
import { BudgetExceededError } from '../types';

jest.mock('@/lib/utils/supabase/server', () => {
  const chain: Record<string, jest.Mock> = {};
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.in = jest.fn().mockResolvedValue({ data: null, error: null });
  chain.update = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  return { createSupabaseServiceClient: jest.fn().mockResolvedValue(chain) };
});

describe('markRunFailed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates run status to failed with agent name in message', async () => {
    await markRunFailed('run-1', 'generation', new Error('LLM timeout'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    expect(supabase.from).toHaveBeenCalledWith('content_evolution_runs');
    const updateCalls = (supabase.update as jest.Mock).mock.calls;
    expect(updateCalls.length).toBeGreaterThan(0);
    const updateArg = updateCalls[0][0];
    expect(updateArg.status).toBe('failed');
    expect(updateArg.error_message).toContain('Agent generation');
    expect(updateArg.error_message).toContain('LLM timeout');
    expect(updateArg.completed_at).toBeDefined();
  });

  it('uses pipeline error prefix when agentName is null', async () => {
    await markRunFailed('run-2', null, new Error('Unexpected'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    const updateArg = (supabase.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.error_message).toContain('Pipeline error');
  });

  it('truncates error message to 500 characters', async () => {
    const longMessage = 'x'.repeat(600);
    await markRunFailed('run-3', 'test', new Error(longMessage));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    const updateArg = (supabase.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.error_message.length).toBeLessThanOrEqual(500);
  });

  it('guards transition with .in() on non-terminal statuses', async () => {
    await markRunFailed('run-4', 'test', new Error('fail'));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    const inCalls = (supabase.in as jest.Mock).mock.calls;
    expect(inCalls.length).toBeGreaterThan(0);
    expect(inCalls[0][0]).toBe('status');
    expect(inCalls[0][1]).toEqual(['pending', 'claimed', 'running', 'continuation_pending']);
  });
});

describe('markRunPaused', () => {
  beforeEach(() => jest.clearAllMocks());

  it('updates run status to paused with budget error message', async () => {
    const error = new BudgetExceededError('generation', 5.0, 5.0);
    await markRunPaused('run-5', error);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createSupabaseServiceClient } = require('@/lib/utils/supabase/server');
    const supabase = await createSupabaseServiceClient();

    expect(supabase.from).toHaveBeenCalledWith('content_evolution_runs');
    const updateArg = (supabase.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.status).toBe('paused');
    expect(updateArg.error_message).toBeDefined();
  });
});
