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
  private makeKey(textA: string, textB: string, structured: boolean): string {
    const sorted = [textA, textB].sort();
    const payload = `${sorted[0].length}:${sorted[0]}|${sorted[1].length}:${sorted[1]}|${structured}`;
    return createHash('sha256').update(payload).digest('hex');
  }

  get(textA: string, textB: string, structured: boolean): CachedMatch | undefined {
    return this.cache.get(this.makeKey(textA, textB, structured));
  }

  /** Only cache valid results (winner resolved or explicit draw). */
  set(textA: string, textB: string, structured: boolean, result: CachedMatch): void {
    if (result.winnerId !== null || result.isDraw) {
      this.cache.set(this.makeKey(textA, textB, structured), result);
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
