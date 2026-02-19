// Shared utility for running LLM critique calls on batches of items.
// Extracts the common build-prompt → call-LLM → parse-response → handle-errors pattern
// used by ReflectionAgent, IterativeEditingAgent.runInlineCritique(), and runFlowCritiques().

import type { Critique, EvolutionLLMClient, EvolutionLogger } from '../types';
import { BudgetExceededError } from '../types';

/** Options for running a batch of critique calls. */
export interface CritiqueBatchOptions<T> {
  /** Items to critique. */
  items: T[];
  /** Build the LLM prompt for a given item. */
  buildPrompt: (item: T) => string;
  /** Agent name passed to llmClient.complete(). */
  agentName: string;
  /** Parse the raw LLM response into a Critique, or null on failure. */
  parseResponse: (raw: string, item: T) => Critique | null;
  /** Run all calls in parallel (default: true). When false, runs sequentially. */
  parallel?: boolean;
  /** Optional logger for debug/warn output. */
  logger?: EvolutionLogger;
}

/** Result of a single critique call within a batch. */
export interface CritiqueBatchEntry<T> {
  item: T;
  status: 'success' | 'parse_failed' | 'error';
  critique: Critique | null;
  error?: string;
}

/**
 * Run critique LLM calls for a batch of items, with shared error handling.
 * BudgetExceededError is always re-thrown; individual failures are captured in entries.
 */
export async function runCritiqueBatch<T>(
  llmClient: EvolutionLLMClient,
  options: CritiqueBatchOptions<T>,
): Promise<{ critiques: Critique[]; entries: CritiqueBatchEntry<T>[] }> {
  const { items, buildPrompt, agentName, parseResponse, parallel = true, logger } = options;

  if (items.length === 0) {
    return { critiques: [], entries: [] };
  }

  const processOne = async (item: T): Promise<CritiqueBatchEntry<T>> => {
    const response = await llmClient.complete(buildPrompt(item), agentName);
    const critique = parseResponse(response, item);
    if (critique) {
      return { item, status: 'success', critique };
    }
    logger?.warn('Critique parse failed', { agentName });
    return { item, status: 'parse_failed', critique: null };
  };

  const entries: CritiqueBatchEntry<T>[] = [];

  if (parallel) {
    const settled = await Promise.allSettled(items.map(processOne));

    for (const result of settled) {
      if (result.status === 'rejected' && result.reason instanceof BudgetExceededError) {
        throw result.reason;
      }
    }

    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        entries.push(result.value);
      } else {
        logger?.error('Critique call failed', { error: String(result.reason) });
        entries.push({ item: items[i], status: 'error', critique: null, error: String(result.reason) });
      }
    });
  } else {
    for (const item of items) {
      try {
        entries.push(await processOne(item));
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        logger?.warn('Critique call failed', { error: String(err) });
        entries.push({ item, status: 'error', critique: null, error: String(err) });
      }
    }
  }

  const critiques = entries
    .filter((e): e is CritiqueBatchEntry<T> & { critique: Critique } => e.critique !== null)
    .map((e) => e.critique);

  return { critiques, entries };
}
