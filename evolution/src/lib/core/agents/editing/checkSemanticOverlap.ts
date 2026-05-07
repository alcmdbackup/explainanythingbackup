// Trigram Jaccard overlap detector for the redundancy guardrail.
// Used by validateEditGroups to drop edits whose newText shares too many word-trigrams
// with the rest of the article (article minus the old range being replaced).
//
// Limitation: lexical, not semantic. Catches verbatim restatements; misses paraphrased
// duplication. Qualitative line of defense is the proposer's anti-redundancy soft rule
// + the approver's redundancy_violation flag.

/** Tokenize on whitespace, lowercase, normalize multiple spaces. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^\w]/g, ''))
    .filter((t) => t.length > 0);
}

/** Build word-level trigram set (sliding 3-word windows). */
export function extractTrigrams(text: string): Set<string> {
  const tokens = tokenize(text);
  if (tokens.length < 3) return new Set();
  const set = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) {
    set.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
  }
  return set;
}

/** Jaccard similarity = |A ∩ B| / |A ∪ B|. Returns 0 if both empty. */
export function jaccardSimilarity(setA: ReadonlySet<string>, setB: ReadonlySet<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const x of setA) {
    if (setB.has(x)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface SemanticOverlapResult {
  overlap: number;
  exceeds: boolean;
}

/** Compute trigram Jaccard overlap between newText and the rest of the article (article
 *  minus the edit's old range). Returns whether overlap exceeds the configured threshold.
 *  Edge cases: empty newText / very short text → overlap=0, never exceeds. */
export function checkSemanticOverlap(
  newText: string,
  articleText: string,
  oldRange: { start: number; end: number },
  threshold: number = 0.35,
): SemanticOverlapResult {
  const newTrigrams = extractTrigrams(newText);
  if (newTrigrams.size === 0) return { overlap: 0, exceeds: false };

  // Exclude the old range from the article — that's what's being REPLACED, not "elsewhere".
  const restOfArticle = articleText.slice(0, oldRange.start) + ' ' + articleText.slice(oldRange.end);
  const restTrigrams = extractTrigrams(restOfArticle);
  if (restTrigrams.size === 0) return { overlap: 0, exceeds: false };

  const overlap = jaccardSimilarity(newTrigrams, restTrigrams);
  return { overlap, exceeds: overlap > threshold };
}
