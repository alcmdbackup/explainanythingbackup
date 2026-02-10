// In-memory cache for bias-mitigated comparison results keyed on content hash.
// Eliminates redundant LLM calls when the same text pair is re-matched across iterations.

import { createHash } from 'crypto';

export interface CachedMatch {
  winnerId: string | null;
  loserId: string | null;
  confidence: number;
  isDraw: boolean;
}

export class ComparisonCache {
  private cache = new Map<string, CachedMatch>();

  /** Order-invariant key (sorted pair) — safe at compareWithBiasMitigation level. */
  private makeKey(textA: string, textB: string, structured: boolean, mode = 'quality'): string {
    const sorted = [textA, textB].sort();
    const payload = `${sorted[0].length}:${sorted[0]}|${sorted[1].length}:${sorted[1]}|${structured}|${mode}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  get(textA: string, textB: string, structured: boolean, mode = 'quality'): CachedMatch | undefined {
    return this.cache.get(this.makeKey(textA, textB, structured, mode));
  }

  /** Only cache valid results (winner resolved or explicit draw). */
  set(textA: string, textB: string, structured: boolean, result: CachedMatch, mode = 'quality'): void {
    if (result.winnerId !== null || result.isDraw) {
      this.cache.set(this.makeKey(textA, textB, structured, mode), result);
    }
    // Skip caching error/null results to allow retry on next encounter
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}
