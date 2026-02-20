// Generic 2-pass reversal runner: executes forward + reversed LLM calls and aggregates results.
// Shared by comparison.ts (A/B pairwise) and diffComparison.ts (diff-based direction reversal).

/**
 * Configuration for a 2-pass reversal comparison.
 * @template TParsed - The type returned by parseResponse (e.g. 'A'|'B'|'TIE' or 'ACCEPT'|'REJECT'|'UNSURE')
 * @template TResult - The final aggregated result type
 */
export interface ReversalConfig<TParsed, TResult> {
  /** Build the two prompts. Forward = original order, reverse = swapped order. */
  buildPrompts: () => { forward: string; reverse: string };
  /** Call the LLM with a prompt string and return the raw response. */
  callLLM: (prompt: string) => Promise<string>;
  /** Parse a raw LLM response into a structured label. */
  parseResponse: (response: string) => TParsed;
  /** Combine the parsed forward and reverse results into a final result. */
  aggregate: (forwardParsed: TParsed, reverseParsed: TParsed) => TResult;
}

/**
 * Execute a 2-pass reversal comparison: call LLM on forward and reverse prompts in parallel,
 * parse both responses, and aggregate into a single result.
 *
 * Does NOT catch errors — callers must handle LLM failures.
 */
export async function run2PassReversal<TParsed, TResult>(
  config: ReversalConfig<TParsed, TResult>,
): Promise<TResult> {
  const { forward, reverse } = config.buildPrompts();

  const [forwardResponse, reverseResponse] = await Promise.all([
    config.callLLM(forward),
    config.callLLM(reverse),
  ]);

  const forwardParsed = config.parseResponse(forwardResponse);
  const reverseParsed = config.parseResponse(reverseResponse);

  return config.aggregate(forwardParsed, reverseParsed);
}
