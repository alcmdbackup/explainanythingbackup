// In-memory cache for bias-mitigated comparison results keyed on content hash.
// Eliminates redundant LLM calls when the same text pair is re-matched across iterations.
// Uses LRU eviction (Map insertion order) to bound memory growth.

import { createHash } from 'crypto';

/** Maximum number of entries before LRU eviction kicks in. */
export const MAX_CACHE_SIZE = 500;

export interface CachedMatch {
  winnerId: string | null;
  loserId: string | null;
  confidence: number;
  isDraw: boolean;
}

export class ComparisonCache {
  private cache = new Map<string, CachedMatch>();
  /** Cache individual text content → SHA-256 hash to avoid re-hashing across pairs. */
  private textHashCache = new Map<string, string>();
  private maxSize: number;

  constructor(maxSize: number = MAX_CACHE_SIZE) {
    this.maxSize = maxSize;
  }

  /** Get or compute SHA-256 hash for a single text string. */
  private hashText(text: string): string {
    let h = this.textHashCache.get(text);
    if (h === undefined) {
      h = createHash('sha256').update(text).digest('hex');
      this.textHashCache.set(text, h);
    }
    return h;
  }

  /** Order-invariant key (sorted pair) — safe at compareWithBiasMitigation level. */
  private makeKey(textA: string, textB: string, structured: boolean, mode = 'quality'): string {
    const hA = this.hashText(textA);
    const hB = this.hashText(textB);
    const sorted = hA < hB ? `${hA}|${hB}` : `${hB}|${hA}`;
    return `${sorted}|${structured}|${mode}`;
  }

  get(textA: string, textB: string, structured: boolean, mode = 'quality'): CachedMatch | undefined {
    return this.cache.get(this.makeKey(textA, textB, structured, mode));
  }

  /** Only cache valid results (winner resolved or explicit draw). Evicts oldest entries when full. */
  set(textA: string, textB: string, structured: boolean, result: CachedMatch, mode = 'quality'): void {
    if (result.winnerId !== null || result.isDraw) {
      const key = this.makeKey(textA, textB, structured, mode);
      this.cache.set(key, result);
      this.evictIfNeeded();
    }
    // Skip caching error/null results to allow retry on next encounter
  }

  /** Evict oldest entries (Map insertion order) until cache is within maxSize. */
  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxSize) return;
    const toDelete = this.cache.size - this.maxSize;
    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (deleted >= toDelete) break;
      this.cache.delete(key);
      deleted++;
    }
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.textHashCache.clear();
  }

  /** Serialize cache entries for checkpoint persistence. */
  entries(): Array<[string, CachedMatch]> {
    return [...this.cache.entries()];
  }

  /** Restore cache from serialized entries. Respects maxSize — keeps last N entries if input exceeds limit. */
  static fromEntries(entries: Array<[string, CachedMatch]>, maxSize: number = MAX_CACHE_SIZE): ComparisonCache {
    const cache = new ComparisonCache(maxSize);
    // If entries exceed maxSize, only load the last maxSize entries (most recent)
    const startIdx = entries.length > maxSize ? entries.length - maxSize : 0;
    for (let i = startIdx; i < entries.length; i++) {
      cache.cache.set(entries[i][0], entries[i][1]);
    }
    return cache;
  }
}
