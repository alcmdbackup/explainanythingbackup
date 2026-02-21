'use client';
// Client-side helper for calling the unified evolution run endpoint.
// Handles fetch errors, non-200 responses, and optional retry with backoff.

export interface EvolutionRunResponse {
  claimed: boolean;
  runId?: string;
  stopReason?: string;
  durationMs?: number;
  message?: string;
  error?: string;
}

export async function triggerEvolutionRun(
  runId?: string,
  options?: { retries?: number },
): Promise<EvolutionRunResponse> {
  const maxRetries = options?.retries ?? 0;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }

    try {
      const res = await fetch('/api/evolution/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });

      const data: EvolutionRunResponse = await res.json();

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error(data.error ?? 'Unauthorized');
        }
        if (attempt < maxRetries && res.status >= 500) {
          lastError = new Error(data.error ?? `Server error ${res.status}`);
          continue;
        }
        throw new Error(data.error ?? `Request failed with status ${res.status}`);
      }

      return data;
    } catch (err) {
      if (err instanceof TypeError) {
        lastError = new Error('Network error — could not reach server');
        if (attempt < maxRetries) continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error('Request failed after retries');
}
