// Tests for the client-side evolution run fetch helper (retries, error handling, response parsing).

import { triggerEvolutionRun, type EvolutionRunResponse } from './evolutionRunClient';

const originalFetch = global.fetch;
const mockFetch = jest.fn();

beforeEach(() => {
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function jsonResponse(status: number, body: EvolutionRunResponse): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('triggerEvolutionRun', () => {
  it('returns parsed response on 200', async () => {
    const payload: EvolutionRunResponse = {
      claimed: true,
      runId: 'run-42',
      stopReason: 'budget_exhausted',
      durationMs: 1200,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, payload));

    const result = await triggerEvolutionRun('run-42');
    expect(result).toEqual(payload);
  });

  it('sends runId in the POST body', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { claimed: true, runId: 'run-99' }),
    );

    await triggerEvolutionRun('run-99');

    expect(mockFetch).toHaveBeenCalledWith('/api/evolution/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: 'run-99' }),
    });
  });

  it('sends undefined runId when omitted', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { claimed: false, message: 'No pending runs' }),
    );

    await triggerEvolutionRun();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.runId).toBeUndefined();
  });

  it('throws immediately on 401 without retrying', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(401, { claimed: false, error: 'Unauthorized' }),
    );

    await expect(triggerEvolutionRun('r', { retries: 3 })).rejects.toThrow('Unauthorized');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 and returns success on next attempt', async () => {
    jest.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce(jsonResponse(500, { claimed: false, error: 'Internal Server Error' }))
      .mockResolvedValueOnce(jsonResponse(200, { claimed: true, runId: 'run-ok' }));

    const promise = triggerEvolutionRun('run-ok', { retries: 1 });
    await jest.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ claimed: true, runId: 'run-ok' });

    jest.useRealTimers();
  });

  it('throws after exhausting retries on repeated 500s', async () => {
    jest.useFakeTimers();

    mockFetch.mockResolvedValue(jsonResponse(500, { claimed: false, error: 'Server down' }));

    const promise = triggerEvolutionRun('r', { retries: 2 });
    // Capture rejection to avoid unhandled-rejection race with fake timers.
    const caught = promise.catch((e: Error) => e);

    await jest.runAllTimersAsync();

    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Server down');
    expect(mockFetch).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
  });

  it('retries on network TypeError and succeeds', async () => {
    jest.useFakeTimers();

    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, { claimed: true, runId: 'run-net' }));

    const promise = triggerEvolutionRun('run-net', { retries: 1 });
    await jest.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ claimed: true, runId: 'run-net' });

    jest.useRealTimers();
  });

  it('throws on first 500 when retries defaults to 0', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { claimed: false, error: 'Boom' }));

    await expect(triggerEvolutionRun('r')).rejects.toThrow('Boom');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
