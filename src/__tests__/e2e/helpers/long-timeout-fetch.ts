// Undici Agent with extended headers/body timeouts for full-pipeline E2E fetches.
//
// Why this exists: `/api/evolution/run` (and other long-running endpoints) await
// the synchronous `claimAndExecuteRun()` which runs the entire pipeline (real
// LLM calls + binary-search ranking) before returning response headers. Node's
// undici default headersTimeout is 5 minutes; pipelines on `gpt-4.1-nano` with
// `$0.05` budget often take ~2-5 minutes but occasionally exceed 5 due to LLM
// provider latency, causing `HeadersTimeoutError` — which is unrelated to the
// pipeline's actual outcome (the polling gate downstream catches genuine failure).
//
// Bumping to 20 minutes covers worst-case pipeline durations under cold caches
// and provider hiccups. The downstream `expect.poll(..., { timeout: 300_000 })`
// remains the source of truth for run completion.

import { Agent } from 'undici';

const TWENTY_MINUTES_MS = 20 * 60 * 1000;

export const longTimeoutDispatcher = new Agent({
  headersTimeout: TWENTY_MINUTES_MS,
  bodyTimeout: TWENTY_MINUTES_MS,
});
