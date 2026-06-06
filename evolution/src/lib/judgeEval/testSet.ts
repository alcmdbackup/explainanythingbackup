// Pure test-set sampling for the judge-evaluation tool. Selects a deterministic subset of
// a pair-bank's pairs (per-kind sizes + strategy + seed) to be frozen as a Test Set, so
// consecutive eval runs compare on identical pairs. No DB / no I/O — fully unit-testable.
// The DB freeze/load lives in persist.ts; this module only decides membership.

import { SeededRandom } from '../shared/seededRandom';
import type { JudgeEvalPair, JudgeEvalTestSetMember, PairKind } from './schemas';

export interface SelectTestSetOptions {
  strategy: 'random' | 'stratified_confidence' | 'stratified_gap' | 'manual';
  seed: number;
  sizeArticle: number;
  sizeParagraph: number;
  /** Required for strategy='manual': explicit pair labels to include. */
  manualLabels?: string[];
}

type SelectedMember = Pick<JudgeEvalTestSetMember, 'pair_label' | 'pair_kind'>;

const CONFIDENCE_BUCKETS = [0, 0.3, 0.5, 0.7, 1.0] as const;

function bucketOfConfidence(c: number | null): number {
  if (c == null) return 0;
  // Snap to the nearest known aggregateWinners value's bucket index.
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < CONFIDENCE_BUCKETS.length; i++) {
    const d = Math.abs(CONFIDENCE_BUCKETS[i]! - c);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Round-robin draw across non-empty strata until `size` picked. Strata are pre-shuffled. */
function stratifiedDraw(
  strata: JudgeEvalPair[][],
  size: number,
  rng: SeededRandom,
): JudgeEvalPair[] {
  const queues = strata.map((s) => rng.shuffle([...s]));
  const out: JudgeEvalPair[] = [];
  let progress = true;
  while (out.length < size && progress) {
    progress = false;
    for (const q of queues) {
      if (out.length >= size) break;
      const next = q.shift();
      if (next) {
        out.push(next);
        progress = true;
      }
    }
  }
  return out;
}

function selectForKind(
  pairs: JudgeEvalPair[],
  kind: PairKind,
  size: number,
  strategy: SelectTestSetOptions['strategy'],
  rng: SeededRandom,
): JudgeEvalPair[] {
  if (size <= 0) return [];
  const pool = pairs.filter((p) => p.pair_kind === kind);
  if (pool.length <= size) return [...pool];

  switch (strategy) {
    case 'random':
      return rng.shuffle([...pool]).slice(0, size);
    case 'stratified_confidence': {
      const strata: JudgeEvalPair[][] = CONFIDENCE_BUCKETS.map(() => []);
      for (const p of pool) strata[bucketOfConfidence(p.baseline_confidence)]!.push(p);
      return stratifiedDraw(strata.filter((s) => s.length > 0), size, rng);
    }
    case 'stratified_gap': {
      const large = pool.filter((p) => p.gap_kind === 'large');
      const close = pool.filter((p) => p.gap_kind === 'close');
      return stratifiedDraw([large, close].filter((s) => s.length > 0), size, rng);
    }
    case 'manual':
      // Manual handled by caller via manualLabels; fall back to deterministic order.
      return rng.shuffle([...pool]).slice(0, size);
  }
}

/**
 * Decide frozen membership for a test set. Deterministic for a fixed (seed, strategy, sizes)
 * and a fixed pair-bank — including across process boundaries (xorshift64* + Fisher-Yates).
 * Members are returned sorted by (pair_kind, pair_label) for stable storage/comparison.
 */
export function selectTestSetMembers(
  pairs: JudgeEvalPair[],
  opts: SelectTestSetOptions,
): SelectedMember[] {
  if (opts.strategy === 'manual') {
    const wanted = new Set(opts.manualLabels ?? []);
    return pairs
      .filter((p) => wanted.has(p.label))
      .map((p) => ({ pair_label: p.label, pair_kind: p.pair_kind }))
      .sort(sortMembers);
  }

  // Separate, independently-seeded RNG per kind so changing one size doesn't reshuffle the other.
  const rngArticle = new SeededRandom(BigInt(opts.seed) ^ BigInt('0x4152540001'));
  const rngParagraph = new SeededRandom(BigInt(opts.seed) ^ BigInt('0x5041524101'));

  const picked = [
    ...selectForKind(pairs, 'article', opts.sizeArticle, opts.strategy, rngArticle),
    ...selectForKind(pairs, 'paragraph', opts.sizeParagraph, opts.strategy, rngParagraph),
  ];
  return picked.map((p) => ({ pair_label: p.label, pair_kind: p.pair_kind })).sort(sortMembers);
}

function sortMembers(a: SelectedMember, b: SelectedMember): number {
  if (a.pair_kind !== b.pair_kind) return a.pair_kind < b.pair_kind ? -1 : 1;
  return a.pair_label < b.pair_label ? -1 : a.pair_label > b.pair_label ? 1 : 0;
}

/** Validate that every selected member references a real pair in the bank (no orphans). */
export function assertMembersExist(
  members: SelectedMember[],
  pairs: JudgeEvalPair[],
): void {
  const labels = new Set(pairs.map((p) => p.label));
  const missing = members.filter((m) => !labels.has(m.pair_label));
  if (missing.length > 0) {
    throw new Error(
      `Test set references ${missing.length} pair label(s) not in the bank: ${missing
        .slice(0, 5)
        .map((m) => m.pair_label)
        .join(', ')}`,
    );
  }
}
