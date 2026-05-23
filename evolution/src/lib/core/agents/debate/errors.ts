// Custom error classes for DebateThenGenerateFromPreviousArticleAgent.
// (bring_back_debate_agent_20260506 Phase 1.13.)

/** Thrown when the combined analyze+judge LLM call fails (network error, timeout,
 *  budget exceeded, model error). The full error chain is captured in the cause. */
export class DebateLLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DebateLLMError';
  }
}

/** Thrown when the combined analyze+judge LLM response cannot be parsed into the
 *  9-field structured shape (JSON parse failure, schema validation failure, missing
 *  required fields). The raw LLM response text is captured in `rawResponse` for
 *  forensic debugging — partial-detail-on-throw persists this onto execution_detail. */
export class DebateParseError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DebateParseError';
  }
}
