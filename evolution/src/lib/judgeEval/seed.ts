// Seed a judge-eval pair-bank from an arena topic by pulling ALL recorded comparison pairs,
// split by kind: article pairs = comparisons on the topic's prompt_id; paragraph pairs =
// comparisons on prompt_kind='paragraph' slot-topics whose run belongs to the topic. Each
// pair snapshots both variant texts + mu/sigma (Elo-gap ground truth) + the production
// judge's recorded confidence. Variants that were deleted are skipped.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { JudgeEvalPair, PairKind } from './schemas';
import { upsertPairBank } from './persist';

type Db = SupabaseClient<Database>;

const PAGE = 1000;
/** mu-gap (OpenSkill scale) at/above which a pair is treated as ground-truth large-gap. */
const LARGE_GAP_MU = 5;

interface RawComparison {
  entry_a: string;
  entry_b: string;
  confidence: number | null;
}

interface VariantInfo {
  content: string;
  mu: number | null;
  sigma: number | null;
}

async function paginate<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = await fetchPage(from, from + PAGE - 1);
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchArticleComparisons(db: Db, topicId: string): Promise<RawComparison[]> {
  return paginate(async (from, to) => {
    const { data, error } = await db
      .from('evolution_arena_comparisons')
      .select('entry_a, entry_b, confidence')
      .eq('prompt_id', topicId)
      .order('created_at', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as RawComparison[];
  });
}

async function fetchParagraphComparisons(db: Db, runIds: string[]): Promise<RawComparison[]> {
  if (runIds.length === 0) return [];
  const out: RawComparison[] = [];
  // Chunk run ids to keep the IN list within PostgREST URL limits.
  for (let i = 0; i < runIds.length; i += 100) {
    const chunk = runIds.slice(i, i + 100);
    const rows = await paginate<RawComparison>(async (from, to) => {
      const { data, error } = await db
        .from('evolution_arena_comparisons')
        .select('entry_a, entry_b, confidence, evolution_prompts!inner(prompt_kind)')
        .in('run_id', chunk)
        .eq('evolution_prompts.prompt_kind', 'paragraph')
        .order('created_at', { ascending: true })
        .range(from, to);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        entry_a: r.entry_a as string,
        entry_b: r.entry_b as string,
        confidence: r.confidence as number | null,
      }));
    });
    out.push(...rows);
  }
  return out;
}

async function fetchVariantInfo(db: Db, ids: string[]): Promise<Map<string, VariantInfo>> {
  const map = new Map<string, VariantInfo>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await db
      .from('evolution_variants')
      .select('id, variant_content, mu, sigma')
      .in('id', chunk);
    if (error) throw error;
    for (const v of data ?? []) {
      map.set(v.id, { content: v.variant_content, mu: v.mu, sigma: v.sigma });
    }
  }
  return map;
}

function dedupePairs(rows: RawComparison[]): Map<string, RawComparison> {
  // Order-invariant key; keep the last-seen confidence (rows are time-ordered ascending).
  const byKey = new Map<string, RawComparison>();
  for (const r of rows) {
    if (!r.entry_a || !r.entry_b) continue;
    const [a, b] = r.entry_a < r.entry_b ? [r.entry_a, r.entry_b] : [r.entry_b, r.entry_a];
    byKey.set(`${a}|${b}`, { entry_a: a, entry_b: b, confidence: r.confidence });
  }
  return byKey;
}

function buildPairs(
  deduped: Map<string, RawComparison>,
  kind: PairKind,
  variants: Map<string, VariantInfo>,
  prefix: string,
): JudgeEvalPair[] {
  const pairs: JudgeEvalPair[] = [];
  let n = 0;
  for (const r of deduped.values()) {
    const va = variants.get(r.entry_a);
    const vb = variants.get(r.entry_b);
    if (!va || !vb) continue; // skip deleted variants
    n += 1;
    const muA = va.mu;
    const muB = vb.mu;
    const gap = muA != null && muB != null ? Math.abs(muA - muB) : 0;
    const isLarge = gap >= LARGE_GAP_MU;
    const expected: 'A' | 'B' | null =
      isLarge && muA != null && muB != null ? (muA >= muB ? 'A' : 'B') : null;
    pairs.push({
      label: `${prefix}#${String(n).padStart(5, '0')}`,
      pair_kind: kind,
      variant_a_id: r.entry_a,
      variant_b_id: r.entry_b,
      text_a: va.content,
      text_b: vb.content,
      mu_a: muA,
      mu_b: muB,
      sigma_a: va.sigma,
      sigma_b: vb.sigma,
      expected_winner: expected,
      gap_kind: isLarge ? 'large' : 'close',
      baseline_confidence: r.confidence,
    });
  }
  return pairs;
}

export interface SeedResult {
  bankId: string;
  articlePairs: number;
  paragraphPairs: number;
  skipped: number;
}

/** Pull all article + paragraph pairs from an arena topic into a (upserted) pair-bank. */
export async function seedPairBankFromTopic(
  db: Db,
  opts: {
    topicId: string;
    bankName: string;
    includeArticles?: boolean;
    includeParagraphs?: boolean;
    /** Per-kind caps on stored pairs. The whole bank's texts live inline in one JSONB row,
     *  so an unbounded seed (FR2 has ~7k article pairs × ~12KB) overflows the PostgREST
     *  upsert payload. Default-cap so the row stays well within limits; test sets sample
     *  from the bank anyway, so a few hundred representative pairs per kind is plenty. */
    maxArticle?: number;
    maxParagraph?: number;
  },
): Promise<SeedResult> {
  const includeArticles = opts.includeArticles ?? true;
  const includeParagraphs = opts.includeParagraphs ?? true;
  const maxArticle = opts.maxArticle ?? 400;
  const maxParagraph = opts.maxParagraph ?? 1500;

  const articleRaw = includeArticles ? await fetchArticleComparisons(db, opts.topicId) : [];
  let paragraphRaw: RawComparison[] = [];
  if (includeParagraphs) {
    const { data: runs, error } = await db
      .from('evolution_runs')
      .select('id')
      .eq('prompt_id', opts.topicId);
    if (error) throw error;
    paragraphRaw = await fetchParagraphComparisons(db, (runs ?? []).map((r) => r.id));
  }

  const articleDedup = dedupePairs(articleRaw);
  const paragraphDedup = dedupePairs(paragraphRaw);

  const allVariantIds = new Set<string>();
  for (const r of articleDedup.values()) {
    allVariantIds.add(r.entry_a);
    allVariantIds.add(r.entry_b);
  }
  for (const r of paragraphDedup.values()) {
    allVariantIds.add(r.entry_a);
    allVariantIds.add(r.entry_b);
  }
  const variants = await fetchVariantInfo(db, [...allVariantIds]);

  const allArticlePairs = buildPairs(articleDedup, 'article', variants, 'art');
  const allParagraphPairs = buildPairs(paragraphDedup, 'paragraph', variants, 'para');
  // Cap per kind to keep the inline-text JSONB within the upsert payload ceiling.
  const articlePairs = maxArticle > 0 ? allArticlePairs.slice(0, maxArticle) : allArticlePairs;
  const paragraphPairs = maxParagraph > 0 ? allParagraphPairs.slice(0, maxParagraph) : allParagraphPairs;
  const skipped =
    articleDedup.size + paragraphDedup.size - articlePairs.length - paragraphPairs.length;

  const bankId = await upsertPairBank(db, {
    name: opts.bankName,
    description: `Seeded from arena topic ${opts.topicId}`,
    sourceTopicId: opts.topicId,
    pairs: [...articlePairs, ...paragraphPairs],
  });

  return { bankId, articlePairs: articlePairs.length, paragraphPairs: paragraphPairs.length, skipped };
}
