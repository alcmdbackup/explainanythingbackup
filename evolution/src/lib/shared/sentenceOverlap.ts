// Sentence-overlap helper for the universal `sentenceVerbatimRatio` quality metric.
// Computes the fraction of parent sentences appearing (verbatim or near-verbatim
// via Levenshtein <= 2) in child text. Pure CPU, microsecond-scale per variant.
//
// Used by all variant-producing agents at variant creation. Observational only —
// no enforcement, no discard. Result lives on `evolution_variants.sentence_verbatim_ratio`
// column and surfaces on the tactic leaderboard, variant detail page, and Phase 7 staging
// analysis (Elo Δ × overlap percentile bucketing per agent).

const SENTENCE_TOKENIZER = /[.!?]\s+/g;
const NEAR_MATCH_LEVENSHTEIN_TOLERANCE = 2;

/** Tokenize text into normalized sentences (lowercased, trimmed, whitespace-collapsed).
 *  Drops empty entries. */
export function extractSentences(text: string): string[] {
  if (!text || text.length === 0) return [];
  return text
    .split(SENTENCE_TOKENIZER)
    .map((s) => s.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0);
}

/** Levenshtein distance, capped at threshold for early exit (returns threshold+1 if exceeded).
 *  O(min(a.length, b.length) * threshold) — cheap when texts are similar. */
function levenshtein(a: string, b: string, threshold: number): number {
  if (Math.abs(a.length - b.length) > threshold) return threshold + 1;
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Single-row DP, capped early.
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1]! === b[j - 1]! ? 0 : 1;
      const v = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      curr.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > threshold) return threshold + 1;
    prev = curr;
  }
  return prev[n]!;
}

/** True if `target` appears in `candidates` exactly OR within Levenshtein <= tolerance.
 *  Catches trivial punctuation/single-word edits that should still count as "verbatim survival". */
function nearMatchInSet(target: string, candidates: ReadonlySet<string>, candidateList: ReadonlyArray<string>): boolean {
  if (candidates.has(target)) return true;
  // Fall back to Levenshtein scan — only triggered when exact lookup misses.
  for (const c of candidateList) {
    // Cheap length pre-filter inside levenshtein() too, but quick check here saves the call.
    if (Math.abs(c.length - target.length) > NEAR_MATCH_LEVENSHTEIN_TOLERANCE) continue;
    if (levenshtein(target, c, NEAR_MATCH_LEVENSHTEIN_TOLERANCE) <= NEAR_MATCH_LEVENSHTEIN_TOLERANCE) {
      return true;
    }
  }
  return false;
}

export interface SentenceOverlapResult {
  ratio: number;
  parentSentenceCount: number;
  childSentenceCount: number;
  intersectionCount: number;
}

/** Compute the fraction of parent sentences appearing in child (exact + near-match). Range [0, 1].
 *  Defaults to 1.0 when parent has zero sentences (degenerate case — nothing was rewritten because
 *  there was nothing to rewrite). */
export function sentenceVerbatimOverlap(parent: string, child: string): SentenceOverlapResult {
  const parentSentences = extractSentences(parent);
  const childSentences = extractSentences(child);
  const childSet = new Set(childSentences);

  if (parentSentences.length === 0) {
    return {
      ratio: 1.0,
      parentSentenceCount: 0,
      childSentenceCount: childSentences.length,
      intersectionCount: 0,
    };
  }

  let intersectionCount = 0;
  for (const ps of parentSentences) {
    if (nearMatchInSet(ps, childSet, childSentences)) intersectionCount++;
  }

  return {
    ratio: intersectionCount / parentSentences.length,
    parentSentenceCount: parentSentences.length,
    childSentenceCount: childSentences.length,
    intersectionCount,
  };
}
