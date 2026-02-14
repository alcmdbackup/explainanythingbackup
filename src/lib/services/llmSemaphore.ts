// Counting semaphore for throttling concurrent LLM API calls during parallel evolution runs.
// Prevents 429 rate limit storms by capping in-flight calls across all concurrent pipelines.

/**
 * A FIFO counting semaphore that limits concurrent access to a shared resource.
 * Used to throttle LLM API calls when running multiple evolution pipelines in parallel.
 */
export class LLMSemaphore {
  private currentCount = 0;
  private readonly waitQueue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error(`LLMSemaphore maxConcurrent must be >= 1, got ${maxConcurrent}`);
    }
  }

  /** Acquire a slot. Resolves immediately if under limit, otherwise queues FIFO. */
  async acquire(): Promise<void> {
    if (this.currentCount < this.maxConcurrent) {
      this.currentCount++;
      return;
    }

    return new Promise<void>((resolve) => {
      // When released, the slot is transferred directly — no increment needed
      this.waitQueue.push(resolve);
    });
  }

  /** Release a slot. Wakes the next waiter in FIFO order if any. */
  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.currentCount--;
    }
  }

  /** Current number of acquired slots. */
  get active(): number {
    return this.currentCount;
  }

  /** Number of waiters in the queue. */
  get waiting(): number {
    return this.waitQueue.length;
  }

  /** Maximum concurrent slots. */
  get limit(): number {
    return this.maxConcurrent;
  }
}

// ─── Module-level singleton ──────────────────────────────────────

const DEFAULT_MAX_CONCURRENT = 20;

let singletonSemaphore: LLMSemaphore | null = null;

/**
 * Get the module-level LLM semaphore singleton.
 * Initialized from EVOLUTION_MAX_CONCURRENT_LLM env var (default: 20).
 */
export function getLLMSemaphore(): LLMSemaphore {
  if (!singletonSemaphore) {
    const envVal = typeof process !== 'undefined'
      ? process.env.EVOLUTION_MAX_CONCURRENT_LLM
      : undefined;
    const maxConcurrent = envVal ? parseInt(envVal, 10) || DEFAULT_MAX_CONCURRENT : DEFAULT_MAX_CONCURRENT;
    singletonSemaphore = new LLMSemaphore(maxConcurrent);
  }
  return singletonSemaphore;
}

/**
 * Re-initialize the singleton with a new concurrency limit.
 * Used by the batch runner to set --max-concurrent-llm from CLI flags.
 */
export function initLLMSemaphore(maxConcurrent: number): LLMSemaphore {
  singletonSemaphore = new LLMSemaphore(maxConcurrent);
  return singletonSemaphore;
}

/** Reset the singleton (for testing). */
export function resetLLMSemaphore(): void {
  singletonSemaphore = null;
}
